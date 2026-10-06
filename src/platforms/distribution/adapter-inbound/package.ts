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
//   - Explicit native package assembly and verification commands.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import { buildDistribution, TARGETS } from "../adapter-outbound/build.ts";
import { verifyDistribution } from "../adapter-outbound/verify.ts";
const args = process.argv.slice(2);
const verify = args[0] === "--verify";
const target = args[verify ? 1 : 0];
const extra = args.slice(verify ? 2 : 1);
if (
  !TARGETS.some((value) => value === target) ||
  extra.some((item) => !verify || item !== "--release")
) {
  process.stderr.write("Choose linux-x64, darwin-arm64, or darwin-x64.\n");
  process.exitCode = 1;
} else {
  try {
    if (verify) {
      await verifyDistribution(
        target as (typeof TARGETS)[number],
        extra.includes("--release"),
      );
      process.stdout.write("Extracted package checks passed.\n");
    } else {
      const result = await buildDistribution(
        target as (typeof TARGETS)[number],
      );
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "distribution-build-failed") +
        "\n",
    );
    process.exitCode = 1;
  }
}
