import { NextRequest, NextResponse } from "next/server";
import { getPad, updatePad } from "@/lib/store";
import { startDownloadJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const updated = await updatePad(id, { status: "downloading", error: null });
  startDownloadJob(pad.id, pad.youtubeUrl);
  return NextResponse.json({ pad: updated });
}
