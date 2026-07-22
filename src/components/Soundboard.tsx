"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import type { Pad } from "@/lib/types";
import { getPads, retryPad, audioUrl } from "@/lib/client";
import PadTile from "./PadTile";
import PadEditor from "./PadEditor";
import Trimmer from "./Trimmer";

type EditorState = { open: true; pad: Pad | null } | { open: false };

export default function Soundboard() {
  const [pads, setPads] = useState<Pad[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [trimming, setTrimming] = useState<Pad | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // One <audio> element per pad, plus the audio version it was created for.
  const audioRefs = useRef<Map<string, { el: HTMLAudioElement; version: number }>>(
    new Map(),
  );

  const refresh = useCallback(async () => {
    try {
      setPads(await getPads());
    } catch {
      /* keep previous state on transient errors */
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Poll while any pad is still downloading.
  const anyDownloading = pads.some((p) => p.status === "downloading");
  useEffect(() => {
    if (!anyDownloading) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [anyDownloading, refresh]);

  // Clean up all audio elements on unmount.
  useEffect(() => {
    const refs = audioRefs.current;
    return () => {
      refs.forEach(({ el }) => {
        el.pause();
        el.src = "";
      });
      refs.clear();
    };
  }, []);

  const stopAll = useCallback(() => {
    audioRefs.current.forEach(({ el }) => {
      el.pause();
      el.currentTime = 0;
    });
    setPlayingId(null);
  }, []);

  const playPad = useCallback(
    (pad: Pad) => {
      // Only one sound at a time; clicking always restarts from the top.
      audioRefs.current.forEach(({ el }, id) => {
        if (id !== pad.id) {
          el.pause();
          el.currentTime = 0;
        }
      });

      let entry = audioRefs.current.get(pad.id);
      // Recreate the element if the audio changed (e.g. after a trim).
      if (!entry || entry.version !== pad.updatedAt) {
        if (entry) {
          entry.el.pause();
          entry.el.src = "";
        }
        const el = new Audio(audioUrl(pad));
        el.addEventListener("ended", () => {
          setPlayingId((cur) => (cur === pad.id ? null : cur));
        });
        entry = { el, version: pad.updatedAt };
        audioRefs.current.set(pad.id, entry);
      }

      entry.el.currentTime = 0;
      void entry.el.play().catch(() => {
        /* autoplay/permission errors are non-fatal */
      });
      setPlayingId(pad.id);
    },
    [],
  );

  async function handleRetry(pad: Pad) {
    try {
      const updated = await retryPad(pad.id);
      upsertPad(updated);
    } catch {
      /* ignore */
    }
  }

  const upsertPad = useCallback((pad: Pad) => {
    setPads((prev) => {
      const idx = prev.findIndex((p) => p.id === pad.id);
      if (idx === -1) return [...prev, pad];
      const next = [...prev];
      next[idx] = pad;
      return next;
    });
  }, []);

  const removePadLocal = useCallback((id: string) => {
    const entry = audioRefs.current.get(id);
    if (entry) {
      entry.el.pause();
      entry.el.src = "";
      audioRefs.current.delete(id);
    }
    setPads((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            🎛️ Soundboard
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Add a pad with a YouTube link — it downloads as MP3, then click to play.
          </p>
        </div>
        {playingId && (
          <button
            onClick={stopAll}
            className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
          >
            Stop
          </button>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-zinc-500">
          <Loader2 className="animate-spin" size={20} /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {pads.map((pad) => (
            <PadTile
              key={pad.id}
              pad={pad}
              isPlaying={playingId === pad.id}
              onPlay={() => playPad(pad)}
              onEdit={() => setEditor({ open: true, pad })}
              onTrim={() => setTrimming(pad)}
              onRetry={() => handleRetry(pad)}
            />
          ))}

          {/* Add-pad tile */}
          <button
            type="button"
            onClick={() => setEditor({ open: true, pad: null })}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/15 text-zinc-500 transition hover:border-indigo-400/60 hover:text-indigo-300"
          >
            <Plus size={30} />
            <span className="text-sm font-medium">Add pad</span>
          </button>
        </div>
      )}

      {editor.open && (
        <PadEditor
          pad={editor.pad}
          onClose={() => setEditor({ open: false })}
          onSaved={upsertPad}
          onDeleted={removePadLocal}
          onOpenTrim={(pad) => setTrimming(pad)}
        />
      )}

      {trimming && (
        <Trimmer
          pad={trimming}
          onClose={() => setTrimming(null)}
          onUpdated={(pad) => {
            upsertPad(pad);
            setTrimming(null);
          }}
        />
      )}
    </div>
  );
}
