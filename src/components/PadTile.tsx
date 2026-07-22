"use client";

import { Loader2, Settings, Scissors, RotateCw, AlertTriangle } from "lucide-react";
import type { Pad } from "@/lib/types";
import { iconUrl, formatTime } from "@/lib/client";

export default function PadTile({
  pad,
  isPlaying,
  onPlay,
  onEdit,
  onTrim,
  onRetry,
}: {
  pad: Pad;
  isPlaying: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onTrim: () => void;
  onRetry: () => void;
}) {
  const ready = pad.status === "ready";
  const downloading = pad.status === "downloading";
  const errored = pad.status === "error";

  return (
    <div
      className={[
        "group relative aspect-square select-none overflow-hidden rounded-2xl border text-left transition",
        ready
          ? "cursor-pointer border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-900 hover:border-indigo-400/60 active:scale-[0.98]"
          : errored
            ? "border-red-500/40 bg-red-950/40"
            : "border-white/10 bg-zinc-900",
        isPlaying ? "ring-2 ring-indigo-400" : "",
      ].join(" ")}
      onClick={() => ready && onPlay()}
      role={ready ? "button" : undefined}
      aria-label={ready ? `Play ${pad.label || pad.title || "sound"}` : undefined}
    >
      {/* Corner controls */}
      <div className="absolute right-1.5 top-1.5 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100">
        {ready && (
          <button
            type="button"
            title="Trim audio"
            onClick={(e) => {
              e.stopPropagation();
              onTrim();
            }}
            className="rounded-lg bg-black/50 p-1.5 text-zinc-200 backdrop-blur transition hover:bg-black/70"
          >
            <Scissors size={15} />
          </button>
        )}
        <button
          type="button"
          title="Settings"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="rounded-lg bg-black/50 p-1.5 text-zinc-200 backdrop-blur transition hover:bg-black/70"
        >
          <Settings size={15} />
        </button>
      </div>

      {/* Icon area */}
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
        <div className="flex flex-1 items-center justify-center">
          {pad.hasIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconUrl(pad)}
              alt=""
              className="max-h-20 max-w-20 rounded-xl object-contain drop-shadow"
              draggable={false}
            />
          ) : (
            <span className="text-5xl leading-none drop-shadow" aria-hidden>
              {pad.emoji || "🎵"}
            </span>
          )}
        </div>
        <div className="w-full text-center">
          <div className="truncate text-sm font-medium text-zinc-100">
            {pad.label || pad.title || "Untitled"}
          </div>
          {ready && (
            <div className="mt-0.5 text-xs text-zinc-500">
              {formatTime(pad.duration)}
              {pad.trim ? " · trimmed" : ""}
            </div>
          )}
        </div>
      </div>

      {/* Status overlays */}
      {downloading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/75 text-zinc-300 backdrop-blur-sm">
          <Loader2 size={26} className="animate-spin text-indigo-400" />
          <span className="text-xs font-medium">Downloading…</span>
          <span className="max-w-[85%] truncate text-[11px] text-zinc-500">
            {pad.title || pad.youtubeUrl}
          </span>
        </div>
      )}

      {errored && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-950/70 p-3 text-center backdrop-blur-sm">
          <AlertTriangle size={22} className="text-red-400" />
          <span className="line-clamp-3 text-[11px] text-red-200">
            {pad.error || "Download failed."}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="mt-1 inline-flex items-center gap-1 rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-100 transition hover:bg-red-500/30"
          >
            <RotateCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Playing indicator bar */}
      {isPlaying && ready && (
        <div className="absolute inset-x-0 bottom-0 h-1 animate-pulse bg-indigo-400" />
      )}
    </div>
  );
}
