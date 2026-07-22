import { NextRequest, NextResponse } from "next/server";
import { getPad, updatePad, removePad } from "@/lib/store";
import { isYouTubeUrl, removeIfExists } from "@/lib/media";
import { startDownloadJob } from "@/lib/jobs";
import { origAudioPath, workingAudioPath, iconPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ pad });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await getPad(id);
  if (!existing)
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body: { label?: string; emoji?: string; youtubeUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Partial<typeof existing> = {};
  if (typeof body.label === "string") patch.label = body.label.trim().slice(0, 40);
  if (typeof body.emoji === "string")
    patch.emoji = body.emoji.trim().slice(0, 8) || "🎵";

  let reDownload = false;
  if (typeof body.youtubeUrl === "string") {
    const url = body.youtubeUrl.trim();
    if (!isYouTubeUrl(url)) {
      return NextResponse.json(
        { error: "That doesn't look like a YouTube link." },
        { status: 400 },
      );
    }
    if (url !== existing.youtubeUrl) {
      patch.youtubeUrl = url;
      patch.status = "downloading";
      patch.error = null;
      reDownload = true;
    }
  }

  const updated = await updatePad(id, patch);
  if (reDownload && updated) {
    startDownloadJob(updated.id, updated.youtubeUrl);
  }
  return NextResponse.json({ pad: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await removePad(id);
  if (!removed)
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  await removeIfExists(origAudioPath(id));
  await removeIfExists(workingAudioPath(id));
  if (removed.iconExt) await removeIfExists(iconPath(id, removed.iconExt));

  return NextResponse.json({ ok: true });
}
