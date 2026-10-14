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
//   - Guarded atomic application exchange and exclusive candidate placement.
// - Must-Not:
//   - Choose update policy, verify publishers, remove apps, or open Terminal.
// - Allows:
//   - Inputs: Trusted local paths and exact expected filesystem identities.
//   - Outputs: Observed exchange orientation or bounded failure reasons.
//   - Side effects: Atomic swap or no-replace rename and directory syncs.
// - Split-When:
//   - Update orchestration needs semantic journal/restart authority.
// - Merge-When:
//   - Node exposes the required atomic exchange syscall directly.
// - Summary:
//   - Retains both applications and inspects outcomes after native completion.
// - Description:
//   - An uncertain process result cannot authorize a blind second exchange.
// - Usage:
//   - Hold the installation lock and quiesce writers in trusted composition.
// - Defaults:
//   - Unsupported hosts and changed identities never invoke exchange.
//
#if defined(__linux__)
#define _GNU_SOURCE
#endif
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdint.h>
#include <inttypes.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#if defined(__linux__)
#include <sys/syscall.h>
#include <linux/fs.h>
#endif

static int number(const char *text, uintmax_t *result) {
  if (!text[0] || strlen(text) > 20 ||
      (text[0] == '0' && text[1])) return 0;
  for (const char *p = text; *p; p++)
    if (*p < '0' || *p > '9') return 0;
  errno = 0;
  char *end = NULL;
  *result = strtoumax(text, &end, 10);
  return !errno && end && !*end;
}
static int identity(const struct stat *state, uintmax_t device,
    uintmax_t inode) {
  return S_ISDIR(state->st_mode) &&
    (uintmax_t)state->st_dev == device && (uintmax_t)state->st_ino == inode;
}
static int path(const char *text) {
  if (text[0] != '/' || strlen(text) > 4096) return 0;
  for (const unsigned char *p = (const unsigned char *)text; *p; p++)
    if (*p < 32 || *p == 127) return 0;
  return 1;
}
static int prepare(int argc, char **argv) {
  if (argc != 10 || !path(argv[2]) || !path(argv[3])) return 64;
  uintmax_t expected[6];
  for (int index = 0; index < 6; index++)
    if (!number(argv[index + 4], &expected[index])) return 64;
  if (expected[0] != expected[2] || expected[0] != expected[4]) return 64;
  int left = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (left < 0) return 73;
  int right = open(argv[3], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (right < 0) { close(left); return 73; }
  struct stat leftParent, rightParent, candidate;
  const char *name = "Blooket API.app";
  int admitted = fstat(left, &leftParent) == 0 &&
    fstat(right, &rightParent) == 0 &&
    identity(&leftParent, expected[2], expected[3]) &&
    identity(&rightParent, expected[4], expected[5]) &&
    leftParent.st_uid == geteuid() && (leftParent.st_mode & 077) == 0 &&
    rightParent.st_uid == geteuid() && (rightParent.st_mode & 077) == 0 &&
    fstatat(left, name, &candidate, AT_SYMLINK_NOFOLLOW) == 0 &&
    identity(&candidate, expected[0], expected[1]);
  int result = 73;
  if (admitted) {
    int app = openat(left, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    struct stat held;
    if (app < 0 || fstat(app, &held) != 0 ||
        !identity(&held, expected[0], expected[1]) ||
        held.st_uid != geteuid()) {
      if (app >= 0) close(app);
      close(right);
      close(left);
      return 73;
    }
    mode_t originalMode = held.st_mode & 0777;
    /* Reparenting a frozen directory needs owner write for its .. entry. */
    if (fchmod(app, originalMode | S_IWUSR) != 0) {
      close(app);
      close(right);
      close(left);
      return 73;
    }
    int placed = -1;
#if defined(__APPLE__)
    placed = renameatx_np(left, name, right, name, RENAME_EXCL);
#elif defined(__linux__) && defined(SYS_renameat2)
    placed = (int)syscall(SYS_renameat2, left, name, right, name,
      RENAME_NOREPLACE);
#else
    errno = ENOTSUP;
#endif
    int restored = fchmod(app, originalMode) == 0 && fsync(app) == 0;
    if (placed == 0)
      result = restored && fsync(left) == 0 && fsync(right) == 0 ? 0 : 74;
    close(app);
  }
  close(right);
  close(left);
  return result;
}
int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--prepare") == 0)
    return prepare(argc, argv);
  if (argc != 11 || !path(argv[1]) || !path(argv[2])) return 64;
  uintmax_t expected[8];
  for (int index = 0; index < 8; index++)
    if (!number(argv[index + 3], &expected[index])) return 64;
  if (expected[0] != expected[2] || expected[0] != expected[4] ||
      expected[0] != expected[6] || expected[1] == expected[3]) return 64;
  int left = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (left < 0) return 73;
  int right = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (right < 0) { close(left); return 73; }
  struct stat leftParent, rightParent, installed, candidate;
  const char *name = "Blooket API.app";
  int admitted = fstat(left, &leftParent) == 0 &&
    fstat(right, &rightParent) == 0 &&
    identity(&leftParent, expected[4], expected[5]) &&
    identity(&rightParent, expected[6], expected[7]) &&
    rightParent.st_uid == geteuid() && (rightParent.st_mode & 077) == 0 &&
    fstatat(left, name, &installed, AT_SYMLINK_NOFOLLOW) == 0 &&
    fstatat(right, name, &candidate, AT_SYMLINK_NOFOLLOW) == 0 &&
    identity(&installed, expected[0], expected[1]) &&
    identity(&candidate, expected[2], expected[3]);
  int result = 73;
  if (admitted) {
    int oldApp = openat(left, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    int newApp = openat(right, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    struct stat oldHeld, newHeld;
    if (oldApp < 0 || newApp < 0 || fstat(oldApp, &oldHeld) != 0 ||
        fstat(newApp, &newHeld) != 0 ||
        !identity(&oldHeld, expected[0], expected[1]) ||
        !identity(&newHeld, expected[2], expected[3])) {
      if (oldApp >= 0) close(oldApp);
      if (newApp >= 0) close(newApp);
      close(right);
      close(left);
      return 73;
    }
    mode_t oldMode = oldHeld.st_mode & 07777;
    mode_t newMode = newHeld.st_mode & 07777;
    /* Both directories change parent during a swap. A frozen candidate needs
       temporary owner write for its .. entry, just as during preparation. */
    int oldWritable = (oldMode & S_IWUSR) ||
      fchmod(oldApp, oldMode | S_IWUSR) == 0;
    int newWritable = (newMode & S_IWUSR) ||
      fchmod(newApp, newMode | S_IWUSR) == 0;
    int exchanged = -1;
    if (oldWritable && newWritable) {
#if defined(__APPLE__)
      exchanged = renameatx_np(left, name, right, name, RENAME_SWAP);
#elif defined(__linux__) && defined(SYS_renameat2)
      exchanged = (int)syscall(SYS_renameat2, left, name, right, name,
        RENAME_EXCHANGE);
#else
      errno = ENOTSUP;
#endif
    }
    /* Restore held inodes at either orientation, including syscall failure.
       Do not chmod a path that may now name the other application. */
    int oldRestored = (oldMode & S_IWUSR) || fchmod(oldApp, oldMode) == 0;
    int newRestored = (newMode & S_IWUSR) || fchmod(newApp, newMode) == 0;
    int oldSynced = fsync(oldApp) == 0;
    int newSynced = fsync(newApp) == 0;
    if (exchanged == 0)
      result = oldRestored && newRestored && oldSynced && newSynced &&
        fsync(left) == 0 && fsync(right) == 0 ? 0 : 74;
    close(newApp);
    close(oldApp);
  }
  close(right);
  close(left);
  return result;
}
