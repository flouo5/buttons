import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listPads, addPad } from "@/lib/store";
import { isYouTubeUrl } from "@/lib/media";
import { startDownloadJob } from "@/lib/jobs";
import type { Pad } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pads = await listPads();
  return NextResponse.json({ pads });
}

export async function POST(request: NextRequest) {
  let body: { label?: string; emoji?: string; youtubeUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const youtubeUrl = (body.youtubeUrl || "").trim();
  if (!youtubeUrl) {
    return NextResponse.json(
      { error: "A YouTube link is required." },
      { status: 400 },
    );
  }
  if (!isYouTubeUrl(youtubeUrl)) {
    return NextResponse.json(
      { error: "That doesn't look like a YouTube link." },
      { status: 400 },
    );
  }

  const now = Date.now();
  const pad: Pad = {
    id: randomUUID(),
    label: (body.label || "").trim().slice(0, 40),
    emoji: (body.emoji || "").trim().slice(0, 8) || "🎵",
    hasIcon: false,
    iconExt: null,
    youtubeUrl,
    status: "downloading",
    error: null,
    title: null,
    duration: null,
    sourceDuration: null,
    trim: null,
    createdAt: now,
    updatedAt: now,
  };

  await addPad(pad);
  startDownloadJob(pad.id, youtubeUrl);

  return NextResponse.json({ pad }, { status: 201 });
}
