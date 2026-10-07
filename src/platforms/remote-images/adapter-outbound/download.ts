// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE-MIT
//
// Boundary-Contract:
// - Owns:
//   - Public image retrieval with pinned DNS and bounded bytes.
// - Must-Not:
//   - Reach private hosts or send local credentials.
// - Allows:
//   - Inputs: An admitted HTTP or HTTPS image URL.
//   - Outputs: Bounded image bytes and an admitted content type.
//   - Side effects: DNS lookup and public HTTP requests.
// - Split-When:
//   - Another remote provider needs different retrieval policy.
// - Merge-When:
//   - Remote image retrieval is no longer a separate capability.
// - Summary:
//   - Rechecks every redirect before connecting.
// - Description:
//   - Pins admitted DNS answers while retaining the TLS hostname.
// - Usage:
//   - Use only from an explicit local clipboard action.
// - Defaults:
//   - Twenty-second deadline, three redirects, and 25 MB maximum.
//
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES = 25_000_000;
export function publicImageAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) !== 6) return false;
  const first = Number.parseInt(address.split(":")[0]!, 16);
  // Global unicast only; exclude protocol, documentation, and 6to4 ranges.
  const second = Number.parseInt(address.split(":")[1] || "0", 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x3fff &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
  );
}

export function imageDownloadUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid-image-url");
  }
  if (
    input.length > 4096 ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !url.hostname ||
    url.hostname.endsWith(".")
  )
    throw new Error("invalid-image-url");
  return url;
}

export async function downloadImage(
  input: string,
  dependencies = { lookup, httpRequest, httpsRequest },
): Promise<{ bytes: Buffer; type: string }> {
  const signal = AbortSignal.timeout(20_000);
  let url = imageDownloadUrl(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (signal.aborted) throw new Error("image-download-timeout");
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const addresses = await Promise.race([
      dependencies.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("image-download-timeout")),
          { once: true },
        ),
      ),
    ]).catch(() => {
      throw new Error(
        signal.aborted ? "image-download-timeout" : "image-download-failed",
      );
    });
    if (signal.aborted) throw new Error("image-download-timeout");
    if (
      !addresses.length ||
      addresses.length > 64 ||
      addresses.some((a) => !publicImageAddress(a.address))
    )
      throw new Error("image-url-not-public");
    const address =
      addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
    const result = await new Promise<
      { bytes: Buffer; type: string } | { redirect: string }
    >((resolve, reject) => {
      const request = (
        url.protocol === "https:"
          ? dependencies.httpsRequest
          : dependencies.httpRequest
      )(
        url,
        {
          signal,
          agent: false,
          headers: { Accept: "image/png,image/jpeg,image/gif,image/webp" },
          // Pin the admitted address at connection time; keep hostname for TLS.
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = response.headers.location;
          if ([301, 302, 303, 307, 308].includes(status) && location) {
            response.destroy();
            resolve({ redirect: location });
            return;
          }
          const type = response.headers["content-type"]?.split(";")[0]?.trim();
          if (Number(response.headers["content-length"]) > MAX_BYTES) {
            response.destroy();
            reject(new Error("source-too-large"));
            return;
          }
          if (
            status !== 200 ||
            !type ||
            !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              type,
            )
          ) {
            response.destroy();
            reject(new Error("image-download-not-image"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              response.destroy();
              reject(new Error("source-too-large"));
            } else chunks.push(chunk);
          });
          response.on("error", () =>
            reject(new Error("image-download-failed")),
          );
          response.on("aborted", () =>
            reject(new Error("image-download-failed")),
          );
          response.on("end", () => {
            if (!size) reject(new Error("image-download-not-image"));
            else resolve({ bytes: Buffer.concat(chunks), type });
          });
        },
      );
      request.on("error", () =>
        reject(
          new Error(
            signal.aborted ? "image-download-timeout" : "image-download-failed",
          ),
        ),
      );
      request.end();
    });
    if (!("redirect" in result)) return result;
    const next = imageDownloadUrl(new URL(result.redirect, url).href);
    if (url.protocol === "https:" && next.protocol !== "https:")
      throw new Error("invalid-image-url");
    url = next;
  }
  throw new Error("image-download-redirect-limit");
}
