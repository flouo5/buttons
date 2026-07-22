import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { workingAudioPath, origAudioPath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve a pad's mp3, with HTTP range support so the browser can seek. Files are
// small, so we read from disk and slice in memory. Pass ?src=orig to get the
// full untrimmed source (used by the trimmer); default is the playable file.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const useOrig = request.nextUrl.searchParams.get("src") === "orig";
  const file = useOrig ? origAudioPath(id) : workingAudioPath(id);

  let data: Buffer;
  try {
    data = await fs.readFile(file);
  } catch {
    return new Response("Audio not found.", { status: 404 });
  }

  const total = data.length;
  const range = request.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const startStr = match[1];
      const endStr = match[2];
      let start = startStr ? Number.parseInt(startStr, 10) : 0;
      let end = endStr ? Number.parseInt(endStr, 10) : total - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;

      if (start > end || start >= total) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
        });
      }

      const chunk = data.subarray(start, end + 1);
      return new Response(toArrayBuffer(chunk), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunk.length),
        },
      });
    }
  }

  return new Response(toArrayBuffer(data), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}

// Return a standalone ArrayBuffer backing the given bytes (avoids handing the
// whole pooled Node Buffer to the Response body).
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}
