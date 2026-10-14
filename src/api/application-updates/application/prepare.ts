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
//   - Verified sibling candidate and durable initial preparation record.
// - Must-Not:
//   - Exchange apps, stop services, launch, grant trust, or replay publication.
// - Allows:
//   - Inputs: Trusted installed location/version and signed release authority.
//   - Outputs: Captured prepared journal/store or bounded retained failure.
//   - Side effects: Native assessment, extraction, placement, and journal
//     writes.
// - Split-When:
//   - Independent installation lifetime needs process supervision.
// - Merge-When:
//   - One production updater composes preparation and independent execution.
// - Summary:
//   - Keeps the old app untouched while preparing a recoverable candidate.
// - Description:
//   - A preparation receipt grants neither exchange nor healthy-app authority.
// - Usage:
//   - Local product composition only; never accept paths or keys from MCP.
// - Defaults:
//   - Unsettled writers and uncertain placement retain generated recovery data.
//
import { compareProductVersions, decodeProductVersion } from
  "../../../ir/product-version/contract/version.ts";
import { decodeSignedUpdateManifest } from
  "../../../ir/update-manifests/contract/manifest.ts";
import { decodeUpdateInstallationJournal, sameIdentity,
  type UpdateInstallationJournal } from
  "../../../ir/application-updates/contract/installation.ts";
import { verifySignedUpdateManifest } from
  "../../../platforms/update-signatures/adapter-outbound/verify.ts";
import { verifyAppleInstalledBundle, verifyAppleUpdateBundle,
  type AppleAssessmentCommand } from
  "../../../platforms/update-signatures/adapter-outbound/apple.ts";
import { stageSignedUpdate, type UpdateExtractionOptions } from
  "../../../platforms/update-extraction/adapter-outbound/stage.ts";
import { createUpdatePreparationLocation, type UpdatePreparationLocation } from
  "../../../platforms/update-extraction/adapter-outbound/prepared-location.ts";
import type { BundlePromotionOptions } from
  "../../../platforms/bundle-exchange/adapter-outbound/promote.ts";
import { directoryIdentity } from
  "../../../platforms/bundle-exchange/adapter-outbound/identity.ts";
import { openUpdateInstallationStore, type UpdateInstallationStore } from
  "../../../platforms/update-journals/adapter-outbound/store.ts";

export interface UpdatePreparationOptions {
  readonly installedPath: string;
  readonly installedVersion: string;
  readonly publisherTeamId: string;
  readonly archivePath: string;
  readonly verification: Parameters<typeof verifySignedUpdateManifest>[0];
  readonly signal?: AbortSignal;
  // Native substitutions are trusted composition/testing dependencies only.
  readonly host?: { readonly platform: string; readonly architecture: string };
  readonly assess?: AppleAssessmentCommand;
  readonly extract?: UpdateExtractionOptions["execute"];
  readonly availableBytes?: UpdateExtractionOptions["availableBytes"];
  readonly placement?: Pick<BundlePromotionOptions, "helperPath" | "execute">;
}
type FailureReason = "manifest" | "version" | "old-bundle" | "storage"
  | "extraction" | "promotion" | "candidate-bundle" | "identity" | "journal"
  | "cancelled";
export type UpdatePreparationResult =
  | { readonly status: "prepared";
      readonly authority: UpdateInstallationJournal;
      readonly store: UpdateInstallationStore }
  | { readonly status: "preparation-failed"; readonly reason: FailureReason;
      readonly retainedInstallationId?: string };

export async function prepareSignedUpdateInstallation(
  options: UpdatePreparationOptions,
): Promise<UpdatePreparationResult> {
  const decoded = decodeSignedUpdateManifest(options.verification.document);
  const verified = verifySignedUpdateManifest(options.verification);
  if (!decoded.ok || !verified.ok)
    return { status: "preparation-failed", reason: "manifest" };
  const installedPath = options.installedPath;
  const installedVersion = options.installedVersion;
  const publisherTeamId = options.publisherTeamId;
  try {
    decodeProductVersion(installedVersion);
    if (compareProductVersions(verified.manifest.version,
        installedVersion) <= 0)
      return { status: "preparation-failed", reason: "version" };
  } catch { return { status: "preparation-failed", reason: "version" }; }
  const verification = { document: decoded.value,
    trustedKeys: [...options.verification.trustedKeys],
    release: { ...options.verification.release,
      asset: { ...options.verification.release.asset } } };
  let location: UpdatePreparationLocation | undefined;
  let store: UpdateInstallationStore | undefined;
  let retain = false, completed = false;
  let phase: FailureReason = "old-bundle";
  const fail = (reason: FailureReason): UpdatePreparationResult => ({
    status: "preparation-failed", reason,
    ...(retain && location
      ? { retainedInstallationId: location.installationId } : {}),
  });
  const stopped = () => options.signal?.aborted === true;
  const native = { publisherTeamId,
    ...(options.host ? { host: options.host } : {}),
    ...(options.assess ? { execute: options.assess } : {}),
    ...(options.signal ? { signal: options.signal } : {}) };
  try {
    if (stopped()) return fail("cancelled");
    const installedIdentity = await directoryIdentity(installedPath);
    const old = await verifyAppleInstalledBundle({ ...native,
      bundlePath: installedPath, version: installedVersion });
    if (old.status !== "verified") return fail(stopped()
      ? "cancelled" : "old-bundle");
    if (!sameIdentity(installedIdentity,
        await directoryIdentity(installedPath)))
      return fail("identity");
    phase = "storage";
    location = await createUpdatePreparationLocation(installedPath, {
      ...options.placement, ...(options.host ? { host: options.host } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!sameIdentity(installedIdentity, location.installedIdentity))
      return fail("identity");
    phase = "extraction";
    const staged = await stageSignedUpdate({ directory: location.directory,
      archivePath: options.archivePath, verification,
      ...(options.host ? { host: options.host } : {}),
      ...(options.extract ? { execute: options.extract } : {}),
      ...(options.availableBytes
        ? { availableBytes: options.availableBytes } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (staged.status !== "staged") {
      retain = staged.retainedStageId !== undefined;
      return fail(stopped() ? "cancelled" : "extraction");
    }
    // Placement might occur even if its acknowledgment is lost. Preserve that
    // candidate and every later journal attempt rather than deleting recovery.
    retain = true;
    if (stopped()) return fail("cancelled");
    phase = "promotion";
    const candidateIdentity = await location.promote(staged.stageId);
    phase = "candidate-bundle";
    const candidate = await verifyAppleUpdateBundle({ ...native,
      bundlePath: location.candidatePath, verification });
    if (candidate.status !== "verified") return fail(stopped()
      ? "cancelled" : "candidate-bundle");
    phase = "identity";
    if (!await location.unchanged() ||
        !sameIdentity(candidateIdentity,
          await directoryIdentity(location.candidatePath))) return fail(phase);
    if (stopped()) return fail("cancelled");
    const record = decodeUpdateInstallationJournal({ schemaVersion: 1,
      installationId: location.installationId, installedVersion,
      installedPath, candidatePath: location.candidatePath,
      installedIdentity: location.installedIdentity, candidateIdentity,
      document: decoded.value, phase: "prepared" });
    if (!record.ok) return fail("journal");
    phase = "journal";
    const opened = await openUpdateInstallationStore(location.directory);
    if (!opened.ok) return fail(phase);
    store = opened.store;
    if (await store.create(record.value) !== "created") return fail(phase);
    if (!await location.unchanged() || !sameIdentity(candidateIdentity,
        await directoryIdentity(location.candidatePath)))
      return fail("identity");
    if (stopped()) return fail("cancelled");
    completed = true;
    return { status: "prepared", authority: record.value, store };
  } catch { return fail(stopped() ? "cancelled" : phase); }
  finally {
    if (!completed) {
      try { await store?.close(); }
      catch { retain = true; }
      if (location && !retain) {
        try { await location.discard(); }
        catch { retain = true; }
      }
      // Cleanup uncertainty must remain visible to the local recovery owner.
      if (retain && location)
        return fail(stopped() ? "cancelled" : phase);
    }
  }
}
