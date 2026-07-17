# shellcheck shell=sh
# Resolve the repo-pinned Node onto PATH before a hook runs `node`.
#
# Git invokes hooks with the OS login shell's PATH, not the terminal's —
# so a GUI client (or a plain `git commit` outside an nvm-activated
# shell) runs whatever `node` the system ships, often older than the
# floor the hooks need (.mts type-stripping needs Node >= 24). A shell can
# resolve the pinned Node for this script while leaving a stale PATH for child
# `#!/usr/bin/env node` launchers, so version equality alone is insufficient.
#
# Sourced (not executed) by each hook shim. Reads the version from the
# repo's `.node-version`, finds the matching nvm OR fnm install, and
# prepends its bin dir to PATH. No-op when there is no `.node-version` or no
# matching install (then the hook's own version gate still fires clearly).

# Locate repo root from the hook's own dir (.git-hooks/<shim>), walking
# up to the first dir that has a `.node-version`.
_rn_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
while [ "$_rn_dir" != "/" ] && [ ! -f "$_rn_dir/.node-version" ]; do
  _rn_dir=$(dirname "$_rn_dir")
done
_rn_file="$_rn_dir/.node-version"
[ -f "$_rn_file" ] || return 0

# Read + normalize the pinned version (strip a leading `v`).
_rn_want=$(tr -d ' \t\r\n' < "$_rn_file")
_rn_want=${_rn_want#v}
[ -n "$_rn_want" ] || return 0

# Prepend the pinned Node's bin dir even when this shell already launched the
# correct version. Covers nvm (`versions/node/v<ver>/bin`) and fnm
# (`node-versions/v<ver>/installation/bin`, honoring FNM_DIR and macOS's
# Application Support location). First existing match wins.
_rn_nvm="${NVM_DIR:-$HOME/.nvm}"
_rn_fnm="${FNM_DIR:-$HOME/.local/share/fnm}"
for _rn_bin in \
  "$_rn_nvm/versions/node/v$_rn_want/bin" \
  "$_rn_fnm/node-versions/v$_rn_want/installation/bin" \
  "$HOME/Library/Application Support/fnm/node-versions/v$_rn_want/installation/bin"; do
  if [ -x "$_rn_bin/node" ]; then
    PATH="$_rn_bin:$PATH"
    export PATH
    break
  fi
done

unset _rn_dir _rn_file _rn_want _rn_nvm _rn_fnm _rn_bin
