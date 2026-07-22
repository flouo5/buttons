"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2, Check, RotateCcw } from "lucide-react";
import type { Pad } from "@/lib/types";
import { sourceAudioUrl, applyTrim, resetTrim, formatTime } from "@/lib/client";
import Modal from "./Modal";

// Minimal structural types for the bits of wavesurfer we use. The library is
// imported dynamically (client-only), so we describe just what we call.
interface WsRegion {
  start: number;
  end: number;
}
interface RegionsPluginInstance {
  addRegion(options: {
    start: number;
    end: number;
    color?: string;
    drag?: boolean;
    resize?: boolean;
  }): WsRegion;
  on(event: "region-updated", cb: (region: WsRegion) => void): void;
}
interface RegionsPluginStatic {
  create(): RegionsPluginInstance;
}
interface WaveSurferInstance {
  registerPlugin(plugin: RegionsPluginInstance): RegionsPluginInstance;
  on(event: "decode", cb: (duration: number) => void): void;
  on(event: "timeupdate", cb: (currentTime: number) => void): void;
  on(event: "pause" | "finish", cb: () => void): void;
  setTime(time: number): void;
  play(): void;
  pause(): void;
  destroy(): void;
}
interface WaveSurferStatic {
  create(options: Record<string, unknown>): WaveSurferInstance;
}

export default function Trimmer({
  pad,
  onClose,
  onUpdated,
}: {
  pad: Pad;
  onClose: () => void;
  onUpdated: (pad: Pad) => void;
}) {
  const initialBounds = {
    start: pad.trim?.start ?? 0,
    end: pad.trim?.end ?? pad.sourceDuration ?? 0,
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurferInstance | null>(null);
  // Latest region bounds, read by playback handlers without stale closures.
  const boundsRef = useRef(initialBounds);
  const playRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});

  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [bounds, setBounds] = useState(initialBounds);
  const [duration, setDuration] = useState(pad.sourceDuration ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const WaveSurfer = (await import("wavesurfer.js"))
        .default as unknown as WaveSurferStatic;
      const RegionsPlugin = (
        await import("wavesurfer.js/dist/plugins/regions.esm.js")
      ).default as unknown as RegionsPluginStatic;
      if (cancelled || !containerRef.current) return;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        height: 110,
        waveColor: "#52525b",
        progressColor: "#818cf8",
        cursorColor: "#e4e4e7",
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        url: sourceAudioUrl(pad),
      });
      wsRef.current = ws;

      const regions = ws.registerPlugin(RegionsPlugin.create());

      ws.on("decode", (dur: number) => {
        if (cancelled) return;
        const start = pad.trim?.start ?? 0;
        const end = pad.trim?.end ?? dur;
        boundsRef.current = { start, end };
        setBounds({ start, end });
        setDuration(dur);
        regions.addRegion({
          start,
          end,
          color: "rgba(129, 140, 248, 0.22)",
          drag: true,
          resize: true,
        });
        setLoading(false);
      });

      regions.on("region-updated", (region: WsRegion) => {
        const next = { start: region.start, end: region.end };
        boundsRef.current = next;
        setBounds(next);
      });

      ws.on("timeupdate", (t: number) => {
        if (t >= boundsRef.current.end) {
          ws.pause();
          ws.setTime(boundsRef.current.start);
          setPlaying(false);
        }
      });
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => setPlaying(false));

      playRef.current = () => {
        ws.setTime(boundsRef.current.start);
        ws.play();
        setPlaying(true);
      };
      pauseRef.current = () => ws.pause();
    })();

    return () => {
      cancelled = true;
      try {
        wsRef.current?.destroy();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
    // Load once for this pad's audio version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad.id, pad.updatedAt]);

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      const updated = await applyTrim(pad.id, bounds.start, bounds.end);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply trim.");
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError(null);
    try {
      const updated = await resetTrim(pad.id);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset.");
      setBusy(false);
    }
  }

  const trimmedLength = Math.max(0, bounds.end - bounds.start);

  return (
    <Modal title="Trim audio" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          Drag the edges of the highlighted region to set what the pad plays.
        </p>

        <div className="relative rounded-xl border border-white/10 bg-zinc-950/60 p-3">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-zinc-400">
              <Loader2 size={18} className="animate-spin" /> Loading waveform…
            </div>
          )}
          <div ref={containerRef} />
        </div>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => (playing ? pauseRef.current() : playRef.current())}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-zinc-100 transition hover:bg-white/20 disabled:opacity-50"
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? "Pause" : "Play selection"}
          </button>
          <div className="flex gap-4 font-mono text-xs text-zinc-400">
            <span>Start {formatTime(bounds.start)}</span>
            <span>End {formatTime(bounds.end)}</span>
            <span className="text-indigo-300">
              Length {formatTime(trimmedLength)}
            </span>
          </div>
        </div>

        <div className="text-xs text-zinc-600">
          Full track: {formatTime(duration)}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleReset}
            disabled={busy || (!pad.trim && bounds.start === 0)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-40"
          >
            <RotateCcw size={15} /> Reset to full
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={busy || loading || trimmedLength <= 0}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              Apply trim
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
