import Foundation
import SafariServices

guard CommandLine.arguments.count == 2 else {
  exit(64)
}

let extensionIdentifier = CommandLine.arguments[1]
let semaphore = DispatchSemaphore(value: 0)
var status: Int32 = 0
SFSafariApplication.showPreferencesForExtension(
  withIdentifier: extensionIdentifier
) { error in
  if error != nil { status = 1 }
  semaphore.signal()
}
if semaphore.wait(timeout: .now() + 10) == .timedOut {
  exit(2)
}
exit(status)
