import { NextRequest, NextResponse } from "next/server";
import { getPad, updatePad } from "@/lib/store";
import { trimAudio, resetTrim, probeDuration } from "@/lib/media";
import { workingAudioPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apply a trim.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (pad.status !== "ready") {
    return NextResponse.json(
      { error: "Audio isn't ready to trim yet." },
      { status: 409 },
    );
  }

  let body: { start?: number; end?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) {
    return NextResponse.json(
      { error: "Invalid trim range." },
      { status: 400 },
    );
  }

  try {
    await trimAudio(id, start, end);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trim.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const duration = await probeDuration(workingAudioPath(id));
  const updated = await updatePad(id, (current) => ({
    trim: { start, end },
    duration,
    updatedAt: current.updatedAt + 1,
  }));
  return NextResponse.json({ pad: updated });
}

// Reset trim back to the full source.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    await resetTrim(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reset.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const duration = await probeDuration(workingAudioPath(id));
  const updated = await updatePad(id, (current) => ({
    trim: null,
    duration,
    sourceDuration: duration ?? current.sourceDuration,
    updatedAt: current.updatedAt + 1,
  }));
  return NextResponse.json({ pad: updated });
}
