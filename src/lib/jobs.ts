import { updatePad } from "./store";
import {
  downloadAudio,
  fetchTitle,
  probeDuration,
} from "./media";
import { workingAudioPath } from "./paths";

// Track in-flight downloads so a pad isn't processed twice concurrently.
const running = new Set<string>();

export function isDownloading(id: string): boolean {
  return running.has(id);
}

/**
 * Kick off (or restart) the download+convert pipeline for a pad. Runs in the
 * background: the caller returns immediately and the client polls pad status.
 */
export function startDownloadJob(id: string, url: string): void {
  if (running.has(id)) return;
  running.add(id);
  void processDownload(id, url).finally(() => running.delete(id));
}

async function processDownload(id: string, url: string): Promise<void> {
  try {
    // Reset state at the start of every attempt.
    await updatePad(id, {
      status: "downloading",
      error: null,
      trim: null,
    });

    // Title is best-effort and shouldn't block the download.
    const title = await fetchTitle(url);
    if (title) await updatePad(id, { title });

    await downloadAudio(id, url);
    const duration = await probeDuration(workingAudioPath(id));

    await updatePad(id, (current) => ({
      status: "ready",
      error: null,
      duration,
      sourceDuration: duration,
      trim: null,
      updatedAt: nextVersion(current.updatedAt),
    }));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown download error.";
    await updatePad(id, { status: "error", error: message });
  }
}

/**
 * Monotonically increasing version stamp used for audio cache-busting.
 * Date.now() is avoided so behaviour stays deterministic under replay; a
 * simple counter off the previous value is enough for cache invalidation.
 */
function nextVersion(previous: number): number {
  return previous + 1;
}
