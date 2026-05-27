# shellcheck shell=sh
# Resolve the repo-pinned Node onto PATH before a hook runs `node`.
#
# Git invokes hooks with the OS login shell's PATH, not the terminal's —
# so a GUI client (or a plain `git commit` outside an nvm-activated
# shell) runs whatever `node` the system ships, often older than the
# floor the hooks need (.mts type-stripping needs Node >= 25). This made
# pre-commit bail with "Hook requires Node >= 25.0.0".
#
# Sourced (not executed) by each hook shim. Reads the version from the
# repo's `.node-version`, finds the matching nvm install, and prepends
# its bin dir to PATH. No-op when: already on the pinned version, no
# `.node-version`, or no matching nvm install (then the hook's own
# version gate still fires with a clear message).

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

# Already on it? Nothing to do.
_rn_have=$(node --version 2>/dev/null | sed 's/^v//')
[ "$_rn_have" = "$_rn_want" ] && return 0

# Prepend the matching nvm bin dir if it exists.
_rn_nvm="${NVM_DIR:-$HOME/.nvm}"
_rn_bin="$_rn_nvm/versions/node/v$_rn_want/bin"
if [ -x "$_rn_bin/node" ]; then
  PATH="$_rn_bin:$PATH"
  export PATH
fi

unset _rn_dir _rn_file _rn_want _rn_have _rn_nvm _rn_bin
