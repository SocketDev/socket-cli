/*
 * Native WINDOWS launcher for the V8-startup-snapshot hook dispatcher.
 *
 * The POSIX sibling (dispatch-launcher.c) re-execs node with execv — ONE
 * process transition, no parent left resident. Windows has no execv that
 * REPLACES the image: the CRT's _execv() actually spawns a child and exits the
 * parent, which is precisely the parent-process tax the snapshot work removes
 * on POSIX. So this launcher is honest about the platform — it CreateProcess()es
 * node, WaitForSingleObject()s on it, and propagates the child's exit code. The
 * launcher process therefore stays resident for the child's lifetime (a thin
 * parent that only waits), and the OPEN QUESTION this answers is whether that
 * cheap native parent-wait still preserves the snapshot win, or whether Windows
 * process-creation reintroduces enough tax to erase it. (Measure on Windows CI;
 * see the build note. Correctness is guaranteed regardless by fail-open.)
 *
 * Same contract as the POSIX launcher:
 *   if <dispatch_dir>\snapshot-blob.path names an existing blob:
 *       node --snapshot-blob <blob> <Event>        (the fast path)
 *   else:
 *       node <dispatch_dir>\index.cjs <Event>       (fail-open, always correct)
 *
 * node.path / snapshot-blob.path are build-time-frozen sidecars next to this
 * .exe (build-snapshot-launcher.mts writes them). A missing/blank sidecar, a
 * vanished blob, or ANY error falls open to index.cjs. The blob is a pure
 * startup optimization; its absence is never an error. Fail-open is total —
 * every failure path lands on index.cjs (or, if even that cannot be launched,
 * exits 0, the dispatcher's universal "allow").
 *
 * Built UNICODE (-DUNICODE -D_UNICODE) so paths with non-ASCII survive; all
 * Win32 calls are the W variants. Cross-compiled with mingw:
 *   x86_64-w64-mingw32-gcc -O2 -municode -o dispatch-launcher.exe dispatch-launcher-win.c
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

/* Directory containing this .exe, so the sidecars + index.cjs resolve relative
 * to the launcher's own location (it lives in _dispatch\). */
static int self_dir(wchar_t *out, DWORD cap) {
  wchar_t buf[MAX_PATH];
  DWORD n = GetModuleFileNameW(NULL, buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return -1;
  /* Trim the trailing \<exe-name>. */
  wchar_t *slash = wcsrchr(buf, L'\\');
  if (!slash) return -1;
  *slash = L'\0';
  if (wcslen(buf) + 1 > cap) return -1;
  wcscpy_s(out, cap, buf);
  return 0;
}

/* Read the first line of <dir>\<name> into out (trimmed of trailing CR/LF/space).
 * Returns 0 on a non-empty line, -1 otherwise. The sidecars are ASCII paths
 * written by Node; read as bytes and widen, which is correct for ASCII and the
 * common case. (A non-ASCII frozen path is a rare build-host quirk; on a read
 * miss the launcher simply falls open.) */
static int read_sidecar(const wchar_t *dir, const wchar_t *name, wchar_t *out, DWORD cap) {
  wchar_t path[MAX_PATH];
  if (_snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\%s", dir, name) < 0) return -1;
  FILE *f = _wfopen(path, L"rb");
  if (!f) return -1;
  char raw[MAX_PATH * 2];
  size_t got = fread(raw, 1, sizeof(raw) - 1, f);
  fclose(f);
  if (got == 0) return -1;
  raw[got] = '\0';
  /* Cut at the first newline. */
  for (size_t i = 0; i < got; i++) {
    if (raw[i] == '\n' || raw[i] == '\r') { raw[i] = '\0'; break; }
  }
  /* Trim trailing spaces. */
  size_t len = strlen(raw);
  while (len && raw[len - 1] == ' ') raw[--len] = '\0';
  if (len == 0) return -1;
  /* Widen ASCII bytes to wchar_t. */
  DWORD i = 0;
  for (; raw[i] && i + 1 < cap; i++) out[i] = (wchar_t)(unsigned char)raw[i];
  out[i] = L'\0';
  return i ? 0 : -1;
}

static int file_exists(const wchar_t *p) {
  DWORD a = GetFileAttributesW(p);
  return (a != INVALID_FILE_ATTRIBUTES) && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

/* Append one argument to a Windows command line, quoting + backslash-escaping
 * per the CommandLineToArgvW rules (the de-facto MSVCRT convention) so a path
 * with spaces or trailing backslashes round-trips into argv intact. */
static void append_arg(wchar_t *cmd, size_t cap, const wchar_t *arg) {
  size_t len = wcslen(cmd);
  if (len && len + 1 < cap) cmd[len++] = L' ';
  if (len + 1 < cap) cmd[len++] = L'"';
  size_t backslashes = 0;
  for (const wchar_t *p = arg; *p; p++) {
    if (*p == L'\\') {
      backslashes++;
    } else if (*p == L'"') {
      /* Escape all pending backslashes (they precede a quote) + the quote. */
      for (size_t k = 0; k < backslashes * 2 + 1 && len + 1 < cap; k++) cmd[len++] = L'\\';
      if (len + 1 < cap) cmd[len++] = L'"';
      backslashes = 0;
      continue;
    } else {
      backslashes = 0;
    }
    if (len + 1 < cap) cmd[len++] = *p;
  }
  /* Escape trailing backslashes so the closing quote isn't swallowed. */
  for (size_t k = 0; k < backslashes && len + 1 < cap; k++) cmd[len++] = L'\\';
  if (len + 1 < cap) cmd[len++] = L'"';
  cmd[len] = L'\0';
}

/* CreateProcess node with the given command line, inheriting this process's
 * std handles, wait for it, and return its exit code. Returns -1 if the process
 * could not be created at all (so the caller can try the next fallback). */
static int run_and_wait(const wchar_t *app, wchar_t *cmdline) {
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  /* Children inherit our console + std handles by default (bInheritHandles
   * TRUE, no STARTF_USESTDHANDLES needed for a plain console child). */
  ZeroMemory(&pi, sizeof(pi));
  if (!CreateProcessW(app, cmdline, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    return -1;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0;
  if (!GetExitCodeProcess(pi.hProcess, &code)) code = 0;
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return (int)code;
}

int wmain(int argc, wchar_t **argv) {
  wchar_t dir[MAX_PATH];
  if (self_dir(dir, MAX_PATH) != 0) {
    /* Cannot locate ourselves -> cannot find index.cjs -> universal fail-open. */
    return 0;
  }

  /* node binary: prefer the frozen sidecar; else "node" resolved via PATH.
   * CreateProcessW with a NULL application name + "node" as argv[0] searches
   * PATH (and appends .exe), matching the POSIX execvp fallback. */
  wchar_t node[MAX_PATH] = {0};
  int have_node = (read_sidecar(dir, L"node.path", node, MAX_PATH) == 0 && file_exists(node));

  const wchar_t *event = (argc > 1) ? argv[1] : NULL;

  wchar_t cmd[MAX_PATH * 6];

  /* Fast path: a frozen blob that still exists. */
  wchar_t blob[MAX_PATH];
  if (read_sidecar(dir, L"snapshot-blob.path", blob, MAX_PATH) == 0 && file_exists(blob)) {
    cmd[0] = L'\0';
    append_arg(cmd, MAX_PATH * 6, have_node ? node : L"node");
    append_arg(cmd, MAX_PATH * 6, L"--snapshot-blob");
    append_arg(cmd, MAX_PATH * 6, blob);
    if (event) append_arg(cmd, MAX_PATH * 6, event);
    int rc = run_and_wait(have_node ? node : NULL, cmd);
    if (rc >= 0) return rc;
    /* CreateProcess failed -> fall through to fail-open. */
  }

  /* Fail-open: node <dispatch_dir>\index.cjs <Event>. */
  wchar_t index[MAX_PATH];
  _snwprintf_s(index, MAX_PATH, _TRUNCATE, L"%s\\index.cjs", dir);
  cmd[0] = L'\0';
  append_arg(cmd, MAX_PATH * 6, have_node ? node : L"node");
  append_arg(cmd, MAX_PATH * 6, index);
  if (event) append_arg(cmd, MAX_PATH * 6, event);
  int rc = run_and_wait(have_node ? node : NULL, cmd);
  if (rc >= 0) return rc;

  /* Even index.cjs could not be launched -> allow (exit 0). */
  return 0;
}
