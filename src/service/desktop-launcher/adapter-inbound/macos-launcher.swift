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
//   - Native app launch and explicit login-item control.
// - Must-Not:
//   - Open Terminal, register on ordinary launch, or consume secrets.
// - Allows:
//   - Inputs: Containing app bundle and exact local launcher arguments.
//   - Outputs: Native login status or the packaged launcher exit status.
//   - Side effects: Explicit login registration/removal or ordinary app launch.
// - Split-When:
//   - Registration needs a separately signed native controller.
// - Merge-When:
//   - Login startup no longer needs a native launch-agent executable.
// - Summary:
//   - Uses SMAppService from the main application bundle.
// - Description:
//   - Keeps login registration separate from ordinary service launch.
// - Usage:
//   - Compile as the main Blooket API.app executable.
// - Defaults:
//   - Invalid bundle placement and launcher failures stop without retry loops.
//
import Foundation
import ServiceManagement
import Darwin

let bundle = Bundle.main
let args = Array(CommandLine.arguments.dropFirst())
guard bundle.bundleIdentifier == "com.albertovilla.blooket-api",
      let resources = bundle.resourceURL else {
  exit(64)
}

let loginCommands = ["--login-status", "--login-enable", "--login-disable"]
if args.contains(where: { $0.hasPrefix("--login-") }) {
  guard args.count == 1, loginCommands.contains(args[0]) else { exit(64) }
  let service = SMAppService.agent(
    plistName: "com.albertovilla.blooket-api.background.plist"
  )
  var succeeded = true
  do {
    if args[0] == "--login-enable",
       service.status != .enabled && service.status != .requiresApproval {
      try service.register()
    } else if args[0] == "--login-disable",
              service.status != .notRegistered {
      try service.unregister()
    }
  } catch { succeeded = false }
  let state: String
  switch service.status {
  case .enabled: state = "enabled"
  case .notRegistered: state = "not-registered"
  case .requiresApproval: state = "requires-approval"
  case .notFound: state = "not-found"
  @unknown default: state = "unavailable"
  }
  let response: [String: Any] = ["schemaVersion": 1, "state": state]
  do {
    let bytes = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data("\n".utf8))
  } catch { exit(1) }
  exit(succeeded ? 0 : 1)
}

let process = Process()
process.executableURL = resources.appendingPathComponent("runtime/node")
process.arguments = [resources.appendingPathComponent(
  "app/src/service/desktop-launcher/adapter-inbound/launcher.ts"
).path] + args
process.standardInput = FileHandle.nullDevice
// Finder launch is silent; explicit CLI options retain machine-readable output.
process.standardOutput = args.isEmpty
  ? FileHandle.nullDevice : FileHandle.standardOutput
process.standardError = args.isEmpty
  ? FileHandle.nullDevice : FileHandle.standardError

do {
  try process.run()
  process.waitUntilExit()
  exit(process.terminationStatus)
} catch { exit(1) }
