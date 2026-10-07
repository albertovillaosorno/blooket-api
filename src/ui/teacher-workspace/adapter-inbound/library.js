// Browser-only library selection and clipboard admission.
export const GALLERY_LIMIT = 12;

export function sampleLibrary(records, random = Math.random) {
  const swaps = new Map();
  const selected = [];
  const count = Math.min(records.length, GALLERY_LIMIT);
  for (let i = 0; i < count; i++) {
    const index = i + Math.floor(random() * (records.length - i));
    selected.push(records[swaps.get(index) ?? index]);
    swaps.set(index, swaps.get(i) ?? i);
  }
  return selected;
}

export function clipboardImageUrl(text) {
  if (typeof text !== "string" || text.length > 4096) return null;
  try {
    const url = new URL(text.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function readClipboardImage(clipboard) {
  if (clipboard.read) {
    const items = await clipboard.read();
    const supported = ["image/png", "image/gif", "image/jpeg", "image/webp"];
    for (const item of items) {
      const type = supported.find((candidate) =>
        item.types.includes(candidate),
      );
      if (type) return { image: await item.getType(type) };
    }
    for (const item of items) {
      if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        const url = clipboardImageUrl(text);
        if (url) return { url };
      }
    }
  } else if (clipboard.readText) {
    const url = clipboardImageUrl(await clipboard.readText());
    if (url) return { url };
  }
  throw new Error("clipboard-image-missing");
}
