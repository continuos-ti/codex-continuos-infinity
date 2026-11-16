import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

export interface DevChatImage {
  type: "input_image";
  image_url: string;
  detail: "auto";
}

const mimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function matchesImageSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  }
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP";
}

/** Convert explicitly selected local image files into the native input_image blocks. */
export function loadDevChatImages(paths: readonly string[]): DevChatImage[] {
  if (paths.length > 10) throw new Error("DEV chat accepts at most 10 image attachments per turn");
  let totalBytes = 0;
  return paths.map(path => {
    const absolute = resolve(path);
    const mimeType = mimeTypes[extname(absolute).toLowerCase()];
    if (!mimeType) throw new Error(`Unsupported DEV image type: ${absolute}`);
    const stats = statSync(absolute);
    if (!stats.isFile() || stats.size === 0 || stats.size > 20_000_000) {
      throw new Error(`DEV image must be a nonempty regular file of at most 20 MB: ${absolute}`);
    }
    totalBytes += stats.size;
    if (totalBytes > 50_000_000) throw new Error("DEV images exceed the 50 MB per-turn limit");
    const bytes = readFileSync(absolute);
    if (!matchesImageSignature(bytes, mimeType)) {
      throw new Error(`DEV image content does not match its file type: ${absolute}`);
    }
    return { type: "input_image", image_url: `data:${mimeType};base64,${bytes.toString("base64")}`, detail: "auto" };
  });
}
