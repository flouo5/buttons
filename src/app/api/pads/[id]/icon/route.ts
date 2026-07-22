import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { getPad, updatePad } from "@/lib/store";
import { removeIfExists } from "@/lib/media";
import { iconPath, ensureDirs } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const MAX_ICON_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected form data." }, { status: 400 });
  }

  const file = form.get("icon");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No icon file provided." }, { status: 400 });
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPG, GIF, WEBP or SVG." },
      { status: 415 },
    );
  }
  if (file.size > MAX_ICON_BYTES) {
    return NextResponse.json(
      { error: "Image is too large (max 5 MB)." },
      { status: 413 },
    );
  }

  ensureDirs();
  // Remove a previous icon if it had a different extension.
  if (pad.iconExt && pad.iconExt !== ext) {
    await removeIfExists(iconPath(id, pad.iconExt));
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(iconPath(id, ext), buffer);

  const updated = await updatePad(id, (current) => ({
    hasIcon: true,
    iconExt: ext,
    updatedAt: current.updatedAt + 1,
  }));
  return NextResponse.json({ pad: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pad = await getPad(id);
  if (!pad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (pad.iconExt) await removeIfExists(iconPath(id, pad.iconExt));
  const updated = await updatePad(id, (current) => ({
    hasIcon: false,
    iconExt: null,
    updatedAt: current.updatedAt + 1,
  }));
  return NextResponse.json({ pad: updated });
}
