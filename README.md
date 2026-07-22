# 🎛️ YouTube Soundboard

A small local Next.js app. Each **pad** on the board is a button you set up with
an icon + a YouTube link. On setup the link is **downloaded and converted to
MP3**; after that, **clicking the pad plays the sound**. Once a pad's audio is
ready you can **trim** it to just the part you want.

## What each pad does

- **Icon** — upload an image, or pick an emoji (used when there's no image).
- **YouTube link** — downloaded with `yt-dlp` and converted to MP3 with `ffmpeg`
  in the background. The pad shows a spinner while it works, then becomes
  playable.
- **Click to play** — one sound at a time; clicking restarts it from the top.
- **Trim** (scissors icon on the pad) — drag the edges of the waveform to choose
  the segment the pad plays. Trims are cut from a preserved original, so you can
  re-adjust or **Reset to full** at any time without re-downloading.

## Prerequisites

These must be available to the Node process running the app:

| Tool      | This machine                         | Notes                         |
| --------- | ------------------------------------ | ----------------------------- |
| `ffmpeg`  | `C:\ffmpeg\bin` (on PATH)            | audio conversion + trimming   |
| `ffprobe` | `C:\ffmpeg\bin` (on PATH)            | reads clip durations          |
| `yt-dlp`  | installed as a Python module (`pip`) | invoked as `python -m yt_dlp` |

Install / update `yt-dlp`:

```bash
pip install -U yt-dlp
```

### Overriding tool locations (optional)

Set any of these env vars (e.g. in `.env.local`) if your setup differs from the
defaults:

- `YTDLP_BIN` — path to a standalone `yt-dlp` executable (used instead of the
  `python -m yt_dlp` form).
- `PYTHON_BIN` — python executable for the module form (default `python`).
- `FFMPEG_BIN` / `FFPROBE_BIN` — ffmpeg/ffprobe executables (default `ffmpeg` /
  `ffprobe`).
- `FFMPEG_LOCATION` — directory containing ffmpeg, passed to yt-dlp if it can't
  find ffmpeg on its own.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000 and click **Add pad**.

> Downloading videos from YouTube may be subject to YouTube's Terms of Service.
> This tool is intended for personal, local use.

## Where things are stored

Everything lives under `data/` (gitignored):

- `data/pads.json` — pad metadata
- `data/audio/<id>.orig.mp3` — the full downloaded source (never modified after
  download)
- `data/audio/<id>.mp3` — the currently playable file (equals the source until
  you trim)
- `data/icons/<id>.<ext>` — uploaded pad icons

## How it's built

- **Next.js 16** (App Router) + **React 19** + **Tailwind v4**
- API route handlers under `src/app/api/*` run on the Node runtime and shell out
  to `yt-dlp` / `ffmpeg` / `ffprobe` (`src/lib/media.ts`)
- Downloads run as a background job (`src/lib/jobs.ts`); the client polls pad
  status until it's `ready`
- Waveform trimming UI uses **wavesurfer.js** (`src/components/Trimmer.tsx`)
