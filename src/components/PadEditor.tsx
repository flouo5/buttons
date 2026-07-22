"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload, Scissors } from "lucide-react";
import type { Pad } from "@/lib/types";
import {
  createPad,
  updatePad,
  uploadIcon,
  removeIcon,
  deletePad,
  iconUrl,
} from "@/lib/client";
import Modal from "./Modal";

const EMOJI_CHOICES = [
  "🎵", "🔊", "😂", "👏", "🥁", "🎸", "📢", "🚨",
  "💥", "🐸", "🎺", "🔔", "❤️", "🔥", "⚡", "🎉",
];

export default function PadEditor({
  pad,
  onClose,
  onSaved,
  onDeleted,
  onOpenTrim,
}: {
  pad: Pad | null; // null = create new
  onClose: () => void;
  onSaved: (pad: Pad) => void;
  onDeleted: (id: string) => void;
  onOpenTrim: (pad: Pad) => void;
}) {
  const isNew = pad === null;
  const [url, setUrl] = useState(pad?.youtubeUrl ?? "");
  const [label, setLabel] = useState(pad?.label ?? "");
  const [emoji, setEmoji] = useState(pad?.emoji ?? "🎵");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const showIcon = iconPreview ?? (pad?.hasIcon && !removeExisting ? iconUrl(pad) : null);

  function pickFile(file: File | null) {
    setIconFile(file);
    setRemoveExisting(false);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) {
      setError("A YouTube link is required.");
      return;
    }
    setBusy(true);
    try {
      let saved: Pad;
      if (isNew) {
        saved = await createPad({ youtubeUrl: url.trim(), label, emoji });
      } else {
        saved = await updatePad(pad.id, { youtubeUrl: url.trim(), label, emoji });
      }
      if (iconFile) {
        saved = await uploadIcon(saved.id, iconFile);
      } else if (!isNew && removeExisting && pad.hasIcon) {
        saved = await removeIcon(saved.id);
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    if (!confirm("Delete this pad and its audio?")) return;
    setBusy(true);
    try {
      await deletePad(pad.id);
      onDeleted(pad.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? "New pad" : "Edit pad"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Icon + emoji */}
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-800">
            {showIcon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={showIcon} alt="" className="max-h-16 max-w-16 object-contain" />
            ) : (
              <span className="text-4xl">{emoji || "🎵"}</span>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-white/20"
              >
                <Upload size={14} /> Upload image
              </button>
              {showIcon && (
                <button
                  type="button"
                  onClick={() => {
                    pickFile(null);
                    setRemoveExisting(true);
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-200"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-zinc-500">
              No image? The emoji below is used instead.
            </p>
          </div>
        </div>

        {/* Emoji picker */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Emoji
          </label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setEmoji(choice)}
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-lg text-lg transition",
                  emoji === choice
                    ? "bg-indigo-500/30 ring-1 ring-indigo-400"
                    : "bg-white/5 hover:bg-white/10",
                ].join(" ")}
              >
                {choice}
              </button>
            ))}
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={8}
              className="h-9 w-16 rounded-lg border border-white/10 bg-zinc-800 px-2 text-center text-sm text-zinc-100 outline-none focus:border-indigo-400"
              placeholder="🙂"
            />
          </div>
        </div>

        {/* Label */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Label
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="Optional — shown under the pad"
            className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-400"
          />
        </div>

        {/* YouTube link */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            YouTube link
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-400"
          />
          {!isNew && (
            <p className="mt-1 text-xs text-zinc-500">
              Changing the link re-downloads the audio and clears any trim.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            {!isNew && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 size={15} /> Delete
              </button>
            )}
            {!isNew && pad.status === "ready" && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTrim(pad);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
              >
                <Scissors size={15} /> Trim audio
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {isNew ? "Add & download" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
