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

export function representativeSolidColor(rgba) {
  if (
    !rgba ||
    typeof rgba.length !== "number" ||
    rgba.length < 4 ||
    rgba.length % 4 !== 0 ||
    rgba.length > 256
  )
    return null;
  const clusters = new Map();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const a = rgba[offset + 3];
    if (
      ![r, g, b, a].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      ) ||
      a < 128
    )
      continue;
    const quantize = (value) => Math.min(15, (value + 8) >> 4);
    const key =
      (quantize(r) << 8) | (quantize(g) << 4) | quantize(b);
    const cluster = clusters.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    cluster.count++;
    cluster.r += r;
    cluster.g += g;
    cluster.b += b;
    clusters.set(key, cluster);
  }
  let winner;
  for (const [key, cluster] of clusters) {
    if (
      !winner ||
      cluster.count > winner.cluster.count ||
      (cluster.count === winner.cluster.count && key < winner.key)
    )
      winner = { key, cluster };
  }
  if (!winner) return null;
  let r = Math.round(winner.cluster.r / winner.cluster.count);
  let g = Math.round(winner.cluster.g / winner.cluster.count);
  let b = Math.round(winner.cluster.b / winner.cluster.count);
  const luminance = (54 * r + 183 * g + 19 * b) / 256;
  if (luminance < 48) {
    const blend = (48 - luminance) / (255 - luminance);
    r = Math.round(r + (255 - r) * blend);
    g = Math.round(g + (255 - g) * blend);
    b = Math.round(b + (255 - b) * blend);
  } else if (luminance > 208) {
    const scale = 208 / luminance;
    r = Math.round(r * scale);
    g = Math.round(g * scale);
    b = Math.round(b * scale);
  }
  return (
    "#" +
    [r, g, b]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  );
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
