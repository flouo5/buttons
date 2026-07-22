import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { getPad } from "@/lib/store";
import { iconPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad || !pad.iconExt) {
    return new Response("Not found.", { status: 404 });
  }

  try {
    const data = await fs.readFile(iconPath(id, pad.iconExt));
    const body = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[pad.iconExt] || "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}
