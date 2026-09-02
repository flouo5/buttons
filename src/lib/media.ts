import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import {
  AUDIO_DIR,
  DATA_DIR,
  origAudioPath,
  workingAudioPath,
  ensureDirs,
} from "./paths";

/**
 * Binary configuration. Nothing is assumed about the host: yt-dlp is looked up
 * at runtime (see `resolveYtdlp`) so the app works on a machine with a
 * standalone `yt-dlp` and one where it's only a python module. Override via env:
 *   YTDLP_BIN   - a standalone yt-dlp executable (skips lookup entirely)
 *   PYTHON_BIN  - python executable for the `-m yt_dlp` module form
 *   FFMPEG_BIN  - ffmpeg executable (default: "ffmpeg")
 *   FFPROBE_BIN - ffprobe executable (default: "ffprobe")
 *   FFMPEG_LOCATION - directory containing ffmpeg, passed to yt-dlp
 *   YTDLP_COOKIES_FILE - path to a Netscape cookies.txt
 *   YTDLP_COOKIES_B64  - base64 of that same file (see `resolveCookies`)
 */
const YTDLP_BIN = process.env.YTDLP_BIN;
const PYTHON_BIN = process.env.PYTHON_BIN;
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || "";

/**
 * Auth cookies for YouTube's "confirm you're not a bot" check, which fires on
 * datacenter IPs even for videos that download fine from a home connection.
 *
 * Two ways in, same as VAULT so one exported cookies.txt serves both:
 *   YTDLP_COOKIES_FILE - a path, e.g. a file mounted into the container
 *   YTDLP_COOKIES_B64  - base64 of the file contents
 *
 * Base64 is the practical one: a Netscape cookies.txt is tab-separated and
 * multi-line, and both get mangled on the way through an environment variable.
 * The decoded file lands with mode 0600 on the data volume - not in the repo,
 * not in /tmp.
 *
 * Auf dem Volume und nicht im Tempverzeichnis, weil **yt-dlp in die Datei
 * zurueckschreibt**: es pflegt das Cookie-Glas und erneuert dabei Werte, die
 * YouTube ihm mitgibt. Genau das verlaengert die Lebensdauer der Anmeldung,
 * und Cookies ablaufen zu sehen ist der haeufigste wiederkehrende Ausfall.
 *
 * Deshalb wird die Datei nur geschrieben, wenn sie fehlt oder wenn sich der
 * Env-Wert geaendert hat - erkannt an einem Hash daneben. Wuerde bei jedem
 * Containerstart aus dem Env ueberschrieben, waere jede Erneuerung durch
 * yt-dlp beim naechsten Deploy wieder weg.
 */
let cookiesPath: string | null | undefined;

async function resolveCookies(): Promise<string | null> {
  if (cookiesPath !== undefined) return cookiesPath;

  const fileEnv = process.env.YTDLP_COOKIES_FILE || "";
  if (fileEnv && existsSync(fileEnv)) {
    cookiesPath = fileEnv;
    return cookiesPath;
  }

  const b64 = process.env.YTDLP_COOKIES_B64 || "";
  if (!b64) {
    cookiesPath = null;
    return cookiesPath;
  }

  try {
    const ziel = path.join(DATA_DIR, "cookies.txt");
    const hashDatei = path.join(DATA_DIR, ".cookies-quelle");
    const hash = createHash("sha256").update(b64).digest("hex");

    let schreiben = true;
    if (existsSync(ziel)) {
      const alt = await fs.readFile(hashDatei, "utf8").catch(() => "");
      schreiben = alt.trim() !== hash;
    }
    if (schreiben) {
      await fs.writeFile(ziel, Buffer.from(b64, "base64"), { mode: 0o600 });
      await fs.writeFile(hashDatei, hash, { mode: 0o600 });
      console.log("[media] cookies.txt aus YTDLP_COOKIES_B64 geschrieben");
    }
    cookiesPath = ziel;
  } catch (e) {
    console.error("[media] cookies setup failed:", e);
    cookiesPath = null;
  }
  return cookiesPath;
}

/**
 * Find an executable the way a shell would. Bare `spawn("python")` fails with a
 * bare "spawn python ENOENT" that says nothing about how to fix it, so resolve
 * up front and report what was actually missing.
 */
function onPath(name: string): string | null {
  if (name.includes("/") || name.includes(path.sep)) {
    return existsSync(name) ? name : null;
  }
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Cached only on success — a missing tool may be installed while we run. */
let resolvedYtdlp: { cmd: string; prefix: string[] } | null = null;

function resolveYtdlp(): { cmd: string; prefix: string[] } {
  if (resolvedYtdlp) return resolvedYtdlp;

  if (YTDLP_BIN) {
    resolvedYtdlp = { cmd: YTDLP_BIN, prefix: [] };
    return resolvedYtdlp;
  }

  // Prefer a standalone yt-dlp: it ships its own Python and can self-update.
  const standalone = onPath("yt-dlp");
  if (standalone) {
    resolvedYtdlp = { cmd: standalone, prefix: [] };
    return resolvedYtdlp;
  }

  // Otherwise the module form, with whichever python this host actually has.
  for (const name of PYTHON_BIN ? [PYTHON_BIN] : ["python3", "python"]) {
    const python = onPath(name);
    if (python) {
      resolvedYtdlp = { cmd: python, prefix: ["-m", "yt_dlp"] };
      return resolvedYtdlp;
    }
  }

  throw new Error(
    "yt-dlp was not found. Install it (`pip install -U yt-dlp`, or download the " +
      "standalone build onto your PATH) or point YTDLP_BIN at the executable.",
  );
}

/**
 * A yt-dlp that keeps itself current.
 *
 * YouTube changes its player internals every few weeks. A yt-dlp baked into the
 * image works for a while and then starts failing with extraction errors — and
 * redeploying an image just to bump a binary is the wrong lever. So: copy the
 * image binary once onto the data volume, where it is writable, and let it
 * update itself at most once a day.
 *
 * Two details that matter, both learned the hard way in VAULT:
 *
 *  - The timestamp is written **before** `-U` runs. Otherwise a broken update
 *    never records an attempt and every single request re-runs it.
 *  - Single-flight: concurrent downloads share one update check. Without that,
 *    three pads added at once run three updates over the same file.
 *
 * Any failure falls back to the image binary, so a dead network or a full
 * volume degrades to "works, just not newest". `YTDLP_AUTO_UPDATE=0` turns the
 * whole mechanism off.
 */
const AUTO_UPDATE = process.env.YTDLP_AUTO_UPDATE !== "0";
const UPDATE_INTERVALL_MS = 24 * 60 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 2 * 60 * 1000;

let updatePruefung: Promise<string | null> | null = null;

async function selbstaktuellesYtdlp(): Promise<string | null> {
  const binDir = path.join(DATA_DIR, "bin");
  const ziel = path.join(binDir, "yt-dlp");
  const stempel = path.join(binDir, ".yt-dlp-checked");

  const quelle = resolveYtdlp();
  // Nur der Standalone-Build kann `-U`. Die python-Modul-Form aktualisiert
  // sich ueber pip und wird hier nicht angefasst.
  if (quelle.prefix.length > 0) return null;

  await fs.mkdir(binDir, { recursive: true });
  if (!existsSync(ziel)) {
    await fs.copyFile(quelle.cmd, ziel);
    await fs.chmod(ziel, 0o755);
  }

  let faellig = true;
  try {
    const st = await fs.stat(stempel);
    faellig = Date.now() - st.mtimeMs > UPDATE_INTERVALL_MS;
  } catch {
    faellig = true;
  }
  if (!faellig) return ziel;

  // Stempel VOR dem Update - siehe Kommentar oben.
  await fs.writeFile(stempel, new Date().toISOString());
  const { code, stderr } = await run(ziel, ["-U"], UPDATE_TIMEOUT_MS);
  if (code !== 0) {
    console.error("[media] yt-dlp -U fehlgeschlagen:", cleanupError(stderr));
  }
  return ziel;
}

async function ytdlpCommand(
  args: string[],
): Promise<{ cmd: string; args: string[] }> {
  if (AUTO_UPDATE) {
    try {
      updatePruefung ??= selbstaktuellesYtdlp().finally(() => {
        // Nach Abschluss freigeben, damit der naechste Tag wieder prueft.
        updatePruefung = null;
      });
      const eigenes = await updatePruefung;
      if (eigenes) return { cmd: eigenes, args };
    } catch (e) {
      console.error("[media] Selbst-Update uebersprungen:", e);
    }
  }
  const { cmd, prefix } = resolveYtdlp();
  return { cmd, args: [...prefix, ...args] };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** stderr wird begrenzt: ein haengendes yt-dlp kann Megabytes ausspucken. */
const STDERR_MAX = 64 * 1024;
const PROZESS_TIMEOUT_MS = Number(process.env.YT_TIMEOUT_MS || 15 * 60 * 1000);

function run(
  cmd: string,
  args: string[],
  timeoutMs = PROZESS_TIMEOUT_MS,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const uhr = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      if (stderr.length < STDERR_MAX) stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(uhr);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(uhr);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
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

/**
 * Argumente, die jeder yt-dlp-Aufruf braucht.
 *
 * `--` vor der URL ist kein Zierrat: eine "URL", die mit `-` beginnt, wuerde
 * sonst als Flag geparst. Und der player_client ist ein Notausgang, der
 * gelegentlich den Bot-Check umgeht - aber einzelne Clients brechen unabhaengig
 * vom Rest (`tv` lieferte zeitweise "The page needs to be reloaded"), deshalb
 * nur per Env-Schalter und mit einem Wiederholversuch ohne ihn.
 */
async function gemeinsameArgs(): Promise<string[]> {
  const args = [
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--socket-timeout",
    "30",
    "--max-filesize",
    process.env.YT_MAX_FILESIZE || "3G",
  ];
  const cookies = await resolveCookies();
  if (cookies) args.push("--cookies", cookies);
  if (FFMPEG_LOCATION) args.push("--ffmpeg-location", FFMPEG_LOCATION);
  return args;
}

const PLAYER_CLIENT = process.env.YT_PLAYER_CLIENT || "";

function playerClientArgs(nutzen: boolean): string[] {
  return nutzen && PLAYER_CLIENT
    ? ["--extractor-args", `youtube:player_client=${PLAYER_CLIENT}`]
    : [];
}

/** Genau der Fehler, bei dem ein erzwungener player_client schuld sein kann. */
function nachReloadFehler(stderr: string): boolean {
  return /page needs to be reloaded/i.test(stderr);
}

/** Best-effort fetch of the video title without downloading. */
export async function fetchTitle(url: string): Promise<string | null> {
  const basis = [
    ...(await gemeinsameArgs()),
    "--skip-download",
    "--print",
    "%(title)s",
  ];
  for (const mitClient of [true, false]) {
    if (!mitClient && !PLAYER_CLIENT) break;
    const { cmd, args } = await ytdlpCommand([
      ...basis,
      ...playerClientArgs(mitClient),
      "--",
      url,
    ]);
    try {
      const { code, stdout, stderr } = await run(cmd, args);
      if (code === 0) {
        const title = stdout.trim().split("\n")[0]?.trim();
        if (title) return title;
        return null;
      }
      if (!(mitClient && PLAYER_CLIENT && nachReloadFehler(stderr))) return null;
    } catch {
      return null;
    }
  }
  return null;
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
  const basis = [
    ...(await gemeinsameArgs()),
    "-f",
    "ba/b",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outTemplate,
  ];

  let letzterFehler = "";
  let erfolg = false;
  for (const mitClient of [true, false]) {
    if (!mitClient && !PLAYER_CLIENT) break;
    const { cmd, args } = await ytdlpCommand([
      ...basis,
      ...playerClientArgs(mitClient),
      "--",
      url,
    ]);
    const { code, stderr, timedOut } = await run(cmd, args);
    if (code === 0) {
      erfolg = true;
      break;
    }
    letzterFehler = timedOut
      ? "yt-dlp wurde nach Zeitüberschreitung abgebrochen."
      : botHinweis(cleanupError(stderr), await resolveCookies());
    if (!(mitClient && PLAYER_CLIENT && nachReloadFehler(stderr))) break;
  }
  if (!erfolg) {
    throw new Error(letzterFehler || "yt-dlp failed to download audio.");
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

/**
 * Aus "Sign in to confirm ..." eine Meldung machen, die sagt, was zu tun ist.
 * Ohne diesen Umbau liest man den Rohtext und sucht am falschen Ende.
 *
 * Achtung: "Sign in to confirm" deckt ZWEI Faelle ab, die verschiedene Fixes
 * brauchen - den Bot-Check auf der Server-IP (Cookies helfen) und ein
 * altersbeschraenktes Video (Cookies helfen nur aus einem altersverifizierten
 * Konto, ein frisches Wegwerf-Konto genuegt nicht). Beides in eine
 * IP-Meldung zu verwandeln schickt einen genau dort suchen, wo nichts ist:
 * ein altersbeschraenktes Video scheitert auch dann, wenn die IP sauber ist.
 *
 * Die Originalzeile von yt-dlp bleibt darum in jedem Fall angehaengt - sonst
 * laesst sich hinterher nicht mehr feststellen, in welchem Fall man steckt.
 */
function botHinweis(meldung: string, cookies: string | null): string {
  const alter = /confirm your age|inappropriate for some users/i.test(meldung);
  const bot = /not a bot/i.test(meldung) || /sign in to confirm/i.test(meldung);

  if (alter) {
    return (
      "Dieses Video ist altersbeschraenkt, YouTube verlangt dafuer eine " +
      "Anmeldung - unabhaengig von der Server-IP. Es braucht Cookies aus einem " +
      "altersverifizierten Google-Konto; ein frisches Wegwerf-Konto reicht " +
      `hier meist nicht. (${meldung})`
    );
  }
  if (!bot) return meldung;

  if (cookies) {
    return (
      "YouTube weist die hinterlegten Cookies zurueck - sie sind vermutlich " +
      "abgelaufen. Neu exportieren und YTDLP_COOKIES_B64 ersetzen. " +
      `(${meldung})`
    );
  }
  return (
    "YouTube verlangt auf dieser Server-IP eine Anmeldung (Bot-Schutz). " +
    "Cookies hinterlegen: YTDLP_COOKIES_B64 (base64 einer cookies.txt) oder " +
    `YTDLP_COOKIES_FILE, am besten mit einem Wegwerf-Google-Konto. (${meldung})`
  );
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
