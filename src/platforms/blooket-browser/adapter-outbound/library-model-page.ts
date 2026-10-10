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
//   - Bounded local capture of initial server-rendered My Sets model text.
// - Must-Not:
//   - Execute captured scripts, inspect cookies, or return text to the bridge.
// - Allows:
//   - Inputs: One complete, exact, unfiltered dashboard My Sets document.
//   - Outputs: A local-only model envelope or an unavailable null.
//   - Side effects: DOM inspection only.
// - Split-When:
//   - A different provider build needs another initial-data capture contract.
// - Merge-When:
//   - The provider exposes the same facts through ordinary visible controls.
// - Summary:
//   - Reads JSON push arguments without evaluating provider JavaScript.
// - Description:
//   - Only the extension-local decoder may consume this private envelope.
// - Usage:
//   - Capture after the host protects forms and confirms a fresh document.
// - Defaults:
//   - Mixed builds, unsupported packets, and excessive text fail closed.
//
export function captureBlooketLibraryModel():
  { readonly build: string; readonly source: string } | null {
  try {
    if (location.href !== "https://dashboard.blooket.com/my-sets" ||
        document.readyState !== "complete") return null;
    const builds = new Set<string>();
    const resources = document.querySelectorAll("script[src],link[href]");
    if (resources.length > 500 || document.scripts.length > 200) return null;
    for (const element of resources) {
      const value = element.getAttribute("src") ??
        element.getAttribute("href");
      if (!value) continue;
      const url = new URL(value, location.href);
      if (url.origin !== "https://ac.blooket.com") continue;
      const build = /^\/dashboard\/([a-f0-9]{40})\/_next\/static\//u
        .exec(url.pathname)?.[1];
      if (build) builds.add(build);
    }
    if (builds.size !== 1) return null;
    let source = "";
    let bootstrap = false;
    const prefix = "self.__next_f.push(";
    const bootstrapPrefix =
      "(self.__next_f=self.__next_f||[]).push([0]);";
    for (const script of document.scripts) {
      let text = script.textContent ?? "";
      if (text.startsWith(bootstrapPrefix)) {
        if (bootstrap) return null;
        bootstrap = true;
        text = text.slice(bootstrapPrefix.length);
      }
      if (!text.startsWith(prefix)) continue;
      if (text.length > 5_000_000 || !/\);?$/u.test(text)) return null;
      const packet: unknown = JSON.parse(
        text.slice(prefix.length).replace(/\);?$/u, ""),
      );
      if (!Array.isArray(packet)) return null;
      if (packet.length === 2 && packet[0] === 1 &&
          typeof packet[1] === "string" && bootstrap) {
        source += packet[1];
        if (source.length > 5_000_000) return null;
      } else return null;
    }
    if (!bootstrap || source.length === 0 ||
        new TextEncoder().encode(source).length > 5_000_000) return null;
    return { build: [...builds][0]!, source };
  } catch {
    return null;
  }
}
