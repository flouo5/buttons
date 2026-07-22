import type { Pad } from "./types";

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.error || `Request failed (${res.status}).`);
  }
  return json as T;
}

export async function getPads(): Promise<Pad[]> {
  const res = await fetch("/api/pads", { cache: "no-store" });
  const { pads } = await parse<{ pads: Pad[] }>(res);
  return pads;
}

export async function getPad(id: string): Promise<Pad> {
  const res = await fetch(`/api/pads/${id}`, { cache: "no-store" });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function createPad(input: {
  youtubeUrl: string;
  label?: string;
  emoji?: string;
}): Promise<Pad> {
  const res = await fetch("/api/pads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function updatePad(
  id: string,
  input: { youtubeUrl?: string; label?: string; emoji?: string },
): Promise<Pad> {
  const res = await fetch(`/api/pads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function deletePad(id: string): Promise<void> {
  const res = await fetch(`/api/pads/${id}`, { method: "DELETE" });
  await parse(res);
}

export async function retryPad(id: string): Promise<Pad> {
  const res = await fetch(`/api/pads/${id}/retry`, { method: "POST" });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function uploadIcon(id: string, file: File): Promise<Pad> {
  const form = new FormData();
  form.append("icon", file);
  const res = await fetch(`/api/pads/${id}/icon`, {
    method: "POST",
    body: form,
  });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function removeIcon(id: string): Promise<Pad> {
  const res = await fetch(`/api/pads/${id}/icon`, { method: "DELETE" });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function applyTrim(
  id: string,
  start: number,
  end: number,
): Promise<Pad> {
  const res = await fetch(`/api/pads/${id}/trim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

export async function resetTrim(id: string): Promise<Pad> {
  const res = await fetch(`/api/pads/${id}/trim`, { method: "DELETE" });
  const { pad } = await parse<{ pad: Pad }>(res);
  return pad;
}

/** Cache-busted URL for a pad's playable audio. */
export function audioUrl(pad: Pad): string {
  return `/api/audio/${pad.id}?v=${pad.updatedAt}`;
}

/** Cache-busted URL for a pad's full, untrimmed source audio. */
export function sourceAudioUrl(pad: Pad): string {
  return `/api/audio/${pad.id}?src=orig&v=${pad.updatedAt}`;
}

/** Cache-busted URL for a pad's icon image. */
export function iconUrl(pad: Pad): string {
  return `/api/icons/${pad.id}?v=${pad.updatedAt}`;
}

export function formatTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
