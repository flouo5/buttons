import path from "node:path";
import fs from "node:fs";

/** Root folder that holds all persisted data (gitignored). */
export const DATA_DIR = path.join(process.cwd(), "data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
export const ICONS_DIR = path.join(DATA_DIR, "icons");
export const PADS_FILE = path.join(DATA_DIR, "pads.json");

export function ensureDirs() {
  for (const dir of [DATA_DIR, AUDIO_DIR, ICONS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** The full, untrimmed source audio. Trimming always cuts from this file. */
export function origAudioPath(id: string) {
  return path.join(AUDIO_DIR, `${id}.orig.mp3`);
}

/** The currently playable audio (equals the source until a trim is applied). */
export function workingAudioPath(id: string) {
  return path.join(AUDIO_DIR, `${id}.mp3`);
}

export function iconPath(id: string, ext: string) {
  return path.join(ICONS_DIR, `${id}${ext}`);
}
