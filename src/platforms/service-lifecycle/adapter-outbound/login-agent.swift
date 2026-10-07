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
//   - Native login-agent entry into the packaged background service.
// - Must-Not:
//   - Register itself, open UI, persist secrets, or mutate Blooket.
// - Allows:
//   - Inputs: Its containing application bundle only.
//   - Outputs: The packaged launcher's bounded exit status.
//   - Side effects: Starts or reuses the existing local service without UI.
// - Split-When:
//   - Registration needs a separately signed native controller.
// - Merge-When:
//   - Login startup no longer needs a native launch-agent executable.
// - Summary:
//   - Reuses the packaged launcher for visible opt-in login startup.
// - Description:
//   - Keeps launchd startup on the same single-instance service path.
// - Usage:
//   - Compile into Blooket API.app for the owned LaunchAgent plist.
// - Defaults:
//   - Invalid bundle placement and launcher failures stop without retry loops.
//
import Foundation
import Darwin

let executable = URL(
  fileURLWithPath: CommandLine.arguments[0]
).resolvingSymlinksInPath()
let contents = executable
  .deletingLastPathComponent()
  .deletingLastPathComponent()
  .deletingLastPathComponent()

guard contents.lastPathComponent == "Contents" else {
  exit(64)
}

let node = contents
  .appendingPathComponent("Resources/runtime/node")
let launcher = contents.appendingPathComponent(
  "Resources/app/src/service/desktop-launcher/adapter-inbound/launcher.ts"
)
let process = Process()
process.executableURL = node
process.arguments = [launcher.path, "--no-open"]
process.standardInput = FileHandle.nullDevice
process.standardOutput = FileHandle.nullDevice
process.standardError = FileHandle.nullDevice

do {
  try process.run()
  process.waitUntilExit()
  exit(process.terminationStatus)
} catch {
  exit(1)
}
