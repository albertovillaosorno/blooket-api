# Image processing engine

## Status

Accepted.

## Decision ID

`blooket-api.media.image-processing-engine`

## Context

The media pipeline must validate and transform untrusted JPEG, PNG, WebP, AVIF,
and GIF inputs on the macOS product target. Portable codec tests may also run on
the development host without requiring Linux distribution or host integration.
Animated inputs need frame-aware metadata and future rendition support.

Implementing and maintaining those image codecs in repository TypeScript would
duplicate mature native libraries and create a substantially larger security and
correctness surface than the transformations owned by this product.

## Decision

Use Sharp as the reviewed image decoder and transformation engine. Pin its exact
version in `package.json`, record the current release through Jig version
authority, and keep direct Sharp access inside media adapter code.

Sharp is justified because it provides maintained libvips-backed decoding and
encoding for the required formats, prebuilt binaries for current macOS and Linux
targets, frame metadata for animated GIF/WebP inputs, explicit pixel limits, and
strict warning-level handling for untrusted input. It also avoids spawning
image-processing child processes.

The repository intentionally materializes packages below
`.dependencies/pnpm/node_modules`. Node's ordinary package resolver does not
search that nonstandard modules directory, and Jig forbids a second root
`node_modules`. The Sharp adapter therefore owns the one dynamic module URL that
points at the canonical repository dependency location. Media domain code must
not repeat that path.

Source-image validation first checks repository-owned magic-byte rules. Sharp
then parses metadata, which is used to enforce a caller-supplied total pixel
ceiling across all frames before a complete pixel decode. Successful admission
requires both the repository detector and Sharp to agree on the format.

Product byte limits, pixel limits, rendition dimensions, and upload constraints
are not Sharp defaults. They remain explicit caller or capability inputs so an
upstream library upgrade cannot silently change product policy.

The current GIF renderer preserves source frame delays, loop state, and
duplicate frames. The teacher settings and media library decision supersedes
source-delay preservation for future prepared GIFs with explicit configured FPS,
default 10, and bounded timeline resampling.

Editor transforms render each GIF frame independently to a bounded canvas before
reassembling a paged raw image for one final GIF encode. This avoids multi-page
transform restrictions and prevents one frame's crop or redaction from changing
another frame's geometry. Sharp's GIF encoder is configured not to merge
identical frames because doing so changes the persisted frame sequence even when
total playback time is similar.

Animated WebP is decoded for validation but rendition currently fails closed
until equivalent preservation behavior is implemented and covered by tests.

## Consequences

- Common image codecs and animation parsing use one mature maintained engine.
- Corrupt payloads can be rejected by a complete decode before durable
  publication.
- Decoder resource ceilings stay explicit and testable.
- Native package updates require normal Jig version review and regression tests.
- Packaging must include the platform-specific Sharp/libvips artifacts selected
  by pnpm for the target host.
- Distribution packaging must preserve applicable third-party license notices
  and satisfy the LGPL terms reported by the prebuilt libvips package.

## Rejected Alternatives

- Repository-owned JPEG, PNG, WebP, AVIF, and GIF decoders were rejected because
  codec implementation is not a product differentiator and would increase the
  security surface substantially.
- Shelling out to ImageMagick or similar host tools was rejected because it adds
  a process boundary and an undeclared host dependency.
- Trusting extensions or MIME labels without decoder validation was rejected
  because media intake is untrusted input.
- Creating a root `node_modules` solely for Node resolution was rejected because
  Jig requires package materialization under `.dependencies/pnpm`.

## Verification

`tests/media/image-decoding/adapter-outbound/sharp-image_tests.ts` covers a
complete static decode, animated frame metadata, total pixel ceilings, malformed
payload rejection, and rejection before native decoding for unknown signatures.

`jig versions refresh --authority sharp --root .` records the observed current
Sharp release, and `jig check --root .` enforces the exact package projection.
