/*
 * Native launcher for the V8-startup-snapshot hook dispatcher (hybrid A+B).
 *
 * Claude Code invokes a hook as:  <launcher> <Event>
 * (settings.json points the hook command at this compiled binary.)
 *
 * The launcher's whole job is to re-exec node with the snapshot blob in ONE
 * process transition (execv replaces this image — no fork, no wait, no second
 * resident process), versus snapshot-loader.cjs which must boot a FULL node
 * just to spawnSync a SECOND node. That parent-node startup is the ~13-16ms the
 * loader pays and this binary removes.
 *
 *   if  <dispatch_dir>/snapshot-blob.path exists AND the blob it names exists:
 *       execv node --snapshot-blob <blob> <Event>      (the fast path)
 *   else:
 *       execv node <dispatch_dir>/index.cjs <Event>     (fail-open, always correct)
 *
 * Path resolution is BUILD-TIME-FROZEN into two sidecars written next to this
 * binary by the build step (the same model the snapshot entry uses for
 * DISPATCH_DIR_FROZEN): node.path (abs path to the node binary) and
 * snapshot-blob.path (abs path to the current blob for this runtime+bundle).
 * Reading a frozen line beats re-deriving the node-ver x arch x v8tag x uid x
 * content-hash blob key in C, and keeps the launcher ~null-cost: two small
 * reads + an execv. A missing/blank sidecar or a vanished blob falls open.
 *
 * Fail-open is total: any error anywhere lands on index.cjs, which is correct
 * on every platform/version. The blob is a pure startup optimization; its
 * absence is never an error.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>

#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

/* Absolute path to this executable, so the sidecars + index.cjs resolve
 * relative to the launcher's own location (it lives in _dispatch/). */
static int self_dir(char *out, size_t cap) {
  char buf[PATH_MAX];
#if defined(__APPLE__)
  uint32_t sz = sizeof(buf);
  if (_NSGetExecutablePath(buf, &sz) != 0) return -1;
#else
  ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n <= 0) return -1;
  buf[n] = '\0';
#endif
  char real[PATH_MAX];
  if (!realpath(buf, real)) {
    /* realpath can fail (e.g. dangling); fall back to the raw path. */
    strncpy(real, buf, sizeof(real) - 1);
    real[sizeof(real) - 1] = '\0';
  }
  char *slash = strrchr(real, '/');
  if (!slash) return -1;
  *slash = '\0';
  if (strlen(real) + 1 > cap) return -1;
  strcpy(out, real);
  return 0;
}

/* Read the first line of <dir>/<name> into out (trimmed of trailing \n).
 * Returns 0 on a non-empty line, -1 otherwise. */
static int read_sidecar(const char *dir, const char *name, char *out, size_t cap) {
  char path[PATH_MAX];
  if ((size_t)snprintf(path, sizeof(path), "%s/%s", dir, name) >= sizeof(path)) return -1;
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  if (!fgets(out, (int)cap, f)) { fclose(f); return -1; }
  fclose(f);
  size_t len = strlen(out);
  while (len && (out[len - 1] == '\n' || out[len - 1] == '\r' || out[len - 1] == ' '))
    out[--len] = '\0';
  return len ? 0 : -1;
}

static int file_exists(const char *p) {
  struct stat st;
  return stat(p, &st) == 0;
}

int main(int argc, char **argv) {
  char dir[PATH_MAX];
  if (self_dir(dir, sizeof(dir)) != 0) {
    /* Cannot locate ourselves -> cannot find index.cjs either; exit 0 (the
     * dispatcher's universal fail-open is "allow"). */
    return 0;
  }

  /* node binary: prefer the frozen sidecar; else fall back to PATH via execvp. */
  char node[PATH_MAX] = {0};
  int have_node = (read_sidecar(dir, "node.path", node, sizeof(node)) == 0 && file_exists(node));

  /* The event arg Claude passes (PreToolUse/PostToolUse/Stop/...). May be absent. */
  const char *event = (argc > 1) ? argv[1] : NULL;

  /* Try the fast path: a frozen blob path that still exists on disk. */
  char blob[PATH_MAX];
  if (read_sidecar(dir, "snapshot-blob.path", blob, sizeof(blob)) == 0 && file_exists(blob)) {
    char *args[6];
    int i = 0;
    args[i++] = have_node ? node : (char *)"node";
    args[i++] = (char *)"--snapshot-blob";
    args[i++] = blob;
    if (event) args[i++] = (char *)event;
    args[i] = NULL;
    if (have_node) execv(node, args); else execvp("node", args);
    /* execv only returns on failure -> fall through to fail-open. */
  }

  /* Fail-open: node <dispatch_dir>/index.cjs <Event>. */
  char index[PATH_MAX];
  snprintf(index, sizeof(index), "%s/index.cjs", dir);
  char *fargs[4];
  int j = 0;
  fargs[j++] = have_node ? node : (char *)"node";
  fargs[j++] = index;
  if (event) fargs[j++] = (char *)event;
  fargs[j] = NULL;
  if (have_node) execv(node, fargs); else execvp("node", fargs);

  /* Even index.cjs exec failed -> allow (exit 0, the universal fail-open). */
  return 0;
}
