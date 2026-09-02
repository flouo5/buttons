import { promises as fs } from "node:fs";
import { DATA_DIR, PADS_FILE, ensureDirs } from "./paths";
import type { Pad, PadsFile } from "./types";

/**
 * fs-Fehler auf dem Datenverzeichnis in etwas verwandeln, das man lesen kann.
 *
 * Im Container ist /app/data ein gemountetes Volume. Gehoert es root, waehrend
 * die App als uid 1001 laeuft (USER nextjs im Dockerfile), scheitert JEDER
 * Schreibzugriff mit EACCES - das chown im Image gilt nur fuer das Verzeichnis
 * IM Image, ein Mount darueber bringt seine eigenen Rechte mit. Ohne diese
 * Uebersetzung sieht man davon nur "Request failed (500)" und sucht im Code.
 */
function datenFehler(err: unknown): Error {
  const code = (err as NodeJS.ErrnoException)?.code;
  const roh = err instanceof Error ? err.message : String(err);

  if (code === "EACCES" || code === "EPERM") {
    return new Error(
      `Kein Schreibzugriff auf ${DATA_DIR}. Gehoert das gemountete Volume dem ` +
        `App-User? Im Container: chown -R 1001:1001 ${DATA_DIR} im Entrypoint. ` +
        `(${roh})`,
    );
  }
  if (code === "EROFS") {
    return new Error(`${DATA_DIR} ist read-only gemountet. (${roh})`);
  }
  if (code === "ENOSPC") {
    return new Error(`Kein Platz mehr auf dem Volume ${DATA_DIR}. (${roh})`);
  }
  if (err instanceof SyntaxError) {
    return new Error(
      `${PADS_FILE} ist beschaedigt und laesst sich nicht lesen - die Datei ` +
        `wegraeumen oder aus einem Backup zuruecksetzen. (${roh})`,
    );
  }
  return err instanceof Error ? err : new Error(roh);
}

// Serialize all reads/writes through a single promise chain so concurrent
// route handlers never clobber the JSON file. This process is the only writer.
let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  // Keep the chain alive regardless of whether `fn` resolved or rejected.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readFile(): Promise<PadsFile> {
  try {
    const raw = await fs.readFile(PADS_FILE, "utf8");
    const parsed = JSON.parse(raw) as PadsFile;
    if (!parsed || !Array.isArray(parsed.pads)) return { pads: [] };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { pads: [] };
    throw datenFehler(err);
  }
}

async function writeFile(data: PadsFile): Promise<void> {
  try {
    ensureDirs();
    const tmp = `${PADS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, PADS_FILE);
  } catch (err) {
    throw datenFehler(err);
  }
}

export function listPads(): Promise<Pad[]> {
  return withLock(async () => {
    const { pads } = await readFile();
    return [...pads].sort((a, b) => a.createdAt - b.createdAt);
  });
}

export function getPad(id: string): Promise<Pad | null> {
  return withLock(async () => {
    const { pads } = await readFile();
    return pads.find((p) => p.id === id) ?? null;
  });
}

export function addPad(pad: Pad): Promise<Pad> {
  return withLock(async () => {
    const data = await readFile();
    data.pads.push(pad);
    await writeFile(data);
    return pad;
  });
}

/**
 * Apply a partial update to a pad and persist it. The updater receives the
 * current pad and returns the fields to merge. Returns the updated pad, or
 * null if the pad no longer exists.
 */
export function updatePad(
  id: string,
  patch: Partial<Pad> | ((current: Pad) => Partial<Pad>),
): Promise<Pad | null> {
  return withLock(async () => {
    const data = await readFile();
    const idx = data.pads.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const current = data.pads[idx];
    const fields = typeof patch === "function" ? patch(current) : patch;
    const next = { ...current, ...fields };
    data.pads[idx] = next;
    await writeFile(data);
    return next;
  });
}

export function removePad(id: string): Promise<Pad | null> {
  return withLock(async () => {
    const data = await readFile();
    const idx = data.pads.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const [removed] = data.pads.splice(idx, 1);
    await writeFile(data);
    return removed;
  });
}
