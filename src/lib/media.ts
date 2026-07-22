import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AUDIO_DIR, origAudioPath, workingAudioPath, ensureDirs } from "./paths";

/**
 * Binary configuration. Defaults match this machine (ffmpeg on PATH, yt-dlp
 * installed as a python module). Override via env if your setup differs:
 *   YTDLP_BIN   - a standalone yt-dlp executable (used instead of `python -m yt_dlp`)
 *   PYTHON_BIN  - python executable when using the module form (default: "python")
 *   FFMPEG_BIN  - ffmpeg executable (default: "ffmpeg")
 *   FFPROBE_BIN - ffprobe executable (default: "ffprobe")
 *   FFMPEG_LOCATION - directory containing ffmpeg, passed to yt-dlp
 */
const YTDLP_BIN = process.env.YTDLP_BIN;
const PYTHON_BIN = process.env.PYTHON_BIN || "python";
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || "";

function ytdlpCommand(args: string[]): { cmd: string; args: string[] } {
  if (YTDLP_BIN) return { cmd: YTDLP_BIN, args };
  return { cmd: PYTHON_BIN, args: ["-m", "yt_dlp", ...args] };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Accept only genuine YouTube watch/short URLs. */
export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be"
    );
  } catch {
    return false;
  }
}

/** Best-effort fetch of the video title without downloading. */
export async function fetchTitle(url: string): Promise<string | null> {
  const { cmd, args } = ytdlpCommand([
    "--no-playlist",
    "--skip-download",
    "--print",
    "%(title)s",
    url,
  ]);
  try {
    const { code, stdout } = await run(cmd, args);
    if (code !== 0) return null;
    const title = stdout.trim().split("\n")[0]?.trim();
    return title || null;
  } catch {
    return null;
  }
}

/**
 * Download the audio track for `url` and convert it to mp3, writing both the
 * source copy (<id>.orig.mp3) and the initial playable copy (<id>.mp3).
 * Throws with yt-dlp's stderr on failure.
 */
export async function downloadAudio(id: string, url: string): Promise<void> {
  ensureDirs();
  // Clean up any stale files from a previous attempt for this id.
  await removeIfExists(origAudioPath(id));
  await removeIfExists(workingAudioPath(id));

  const outTemplate = path.join(AUDIO_DIR, `${id}.orig.%(ext)s`);
  const args = [
    "--no-playlist",
    "--no-progress",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outTemplate,
  ];
  if (FFMPEG_LOCATION) args.push("--ffmpeg-location", FFMPEG_LOCATION);
  args.push(url);

  const { cmd, args: fullArgs } = ytdlpCommand(args);
  const { code, stderr } = await run(cmd, fullArgs);
  if (code !== 0) {
    throw new Error(cleanupError(stderr) || "yt-dlp failed to download audio.");
  }

  const orig = origAudioPath(id);
  try {
    await fs.access(orig);
  } catch {
    throw new Error("Download finished but no mp3 was produced.");
  }
  // The freshly downloaded source is also the initial playable file.
  await fs.copyFile(orig, workingAudioPath(id));
}

/**
 * Trim the playable audio to [start, end] (seconds), cutting from the
 * untrimmed source so trims can be re-adjusted without cumulative loss.
 */
export async function trimAudio(
  id: string,
  start: number,
  end: number,
): Promise<void> {
  const orig = origAudioPath(id);
  await fs.access(orig);
  const duration = Math.max(0, end - start);
  if (duration <= 0) throw new Error("Trim end must be after start.");

  const tmp = path.join(AUDIO_DIR, `${id}.trim.tmp.mp3`);
  await removeIfExists(tmp);
  // Input seeking (-ss before -i) + re-encode gives an accurate cut.
  const args = [
    "-y",
    "-ss",
    start.toFixed(3),
    "-i",
    orig,
    "-t",
    duration.toFixed(3),
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    tmp,
  ];
  const { code, stderr } = await run(FFMPEG_BIN, args);
  if (code !== 0) {
    await removeIfExists(tmp);
    throw new Error(cleanupError(stderr) || "ffmpeg failed to trim audio.");
  }
  await fs.rename(tmp, workingAudioPath(id));
}

/** Restore the playable audio to the full untrimmed source. */
export async function resetTrim(id: string): Promise<void> {
  const orig = origAudioPath(id);
  await fs.access(orig);
  await fs.copyFile(orig, workingAudioPath(id));
}

/** Duration of an audio file in seconds, or null if it can't be read. */
export async function probeDuration(file: string): Promise<number | null> {
  try {
    const { code, stdout } = await run(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    if (code !== 0) return null;
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function removeIfExists(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Pull the most useful line out of yt-dlp/ffmpeg stderr for display. */
function cleanupError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errLine = lines.find((l) => /^error/i.test(l));
  return (errLine || lines[lines.length - 1] || "").slice(0, 400);
}

export { removeIfExists };
