export type PadStatus = "downloading" | "ready" | "error";

export interface Pad {
  id: string;
  label: string;
  /** Emoji or short text shown when there is no icon image. */
  emoji: string;
  /** True when an uploaded icon image exists on disk (served via /api/icons/:id). */
  hasIcon: boolean;
  iconExt: string | null;
  youtubeUrl: string;
  status: PadStatus;
  error: string | null;
  /** Resolved YouTube title (best-effort). */
  title: string | null;
  /** Duration of the currently playable (trimmed) audio, in seconds. */
  duration: number | null;
  /** Duration of the full, untrimmed source audio, in seconds. */
  sourceDuration: number | null;
  /** Applied trim window, or null when playing the full track. */
  trim: { start: number; end: number } | null;
  createdAt: number;
  /** Bumped whenever the playable audio file changes; used for cache-busting. */
  updatedAt: number;
}

export interface PadsFile {
  pads: Pad[];
}
