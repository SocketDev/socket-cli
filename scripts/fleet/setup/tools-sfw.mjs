/**
 * @file Sfw flavor + shim helpers for the dep-free tools.mjs bootstrap.
 *   Split out to keep tools.mjs under the file-size cap. Dep-free (system
 *   Node + `node:` builtins only) for the same reason as its caller: it runs
 *   before `@socketsecurity/lib` / node_modules exist.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap: runs before node_modules exists, so the lib spawn wrapper isn't importable; sync child_process is the only option.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

// Detect whether a Socket API token is available — the signal that selects the
// ENTERPRISE sfw flavor (mirrors the CI action's SFW_IS_ENTERPRISE check). Env
// first (CI / shell-rc bridge), THEN the OS keychain (dev — the env bridge may
// not be sourced). PRESENCE-ONLY: never extracts the secret value
// (`find-generic-password` WITHOUT -w; `secret-tool` output discarded), so the
// token never enters this process. Keychain service + accounts match the
// canonical token-storage helper (setup-security-tools/lib/token-storage.mts:
// service `socketsecurity`, legacy `socket-cli`; accounts SOCKET_API_TOKEN +
// SOCKET_API_KEY).
export function hasSocketToken() {
  // The canonical account + its legacy alias. A dev keychain may hold the token
  // under EITHER (the legacy alias is often the only one populated on older
  // machines), so the bootstrap probes both.
  // socket-api-token-env: bootstrap -- legacy SOCKET_API_KEY alias is legitimate here.
  const tokenAccount = 'SOCKET_API_TOKEN'
  const keyAccount = 'SOCKET_API_KEY'
  // socket-api-token-getter: allow direct-env -- pre-pnpm bootstrap; the lib
  // readSocketApiTokenSync() helper isn't on disk yet. PRESENCE only.
  // socket-api-token-env: bootstrap -- both aliases probed in bootstrap.
  if (process.env[tokenAccount] || process.env[keyAccount]) {
    return true
  }
  // Presence-only probe: status 0 = entry exists. No `-w` / no captured stdout,
  // so the secret value never enters this process. Flat OR'd calls (not array
  // loops) to stay dep-free + avoid noisy indexed-loop autofixes.
  const ok = (cmd, args) =>
    spawnSync(cmd, args, { stdio: 'ignore' }).status === 0
  if (process.platform === 'darwin') {
    const find = (service, account) =>
      ok('security', ['find-generic-password', '-s', service, '-a', account])
    return (
      find('socketsecurity', tokenAccount) ||
      find('socketsecurity', keyAccount) ||
      find('socket-cli', tokenAccount) ||
      find('socket-cli', keyAccount)
    )
  }
  if (process.platform === 'linux') {
    const lookup = account =>
      ok('secret-tool', [
        'lookup',
        'service',
        'socketsecurity',
        'user',
        account,
      ])
    return lookup(tokenAccount) || lookup(keyAccount)
  }
  return false
}

// The shim command set, by flavor. Mirrors the CI action's SFW_IS_ENTERPRISE
// branch: free wraps the 7 common managers; enterprise adds gem/bundler/nuget
// (+ go on Linux only — go wrapper mode is Linux-only upstream).
export function shimCommands(enterprise) {
  const base = ['npm', 'yarn', 'pnpm', 'pip', 'pip3', 'uv', 'cargo']
  if (!enterprise) {
    return base
  }
  const extra = ['gem', 'bundler', 'nuget']
  if (process.platform === 'linux') {
    extra.push('go')
  }
  return [...base, ...extra]
}

// The persistent Socket Firewall CA env pair, as shell fragments. sfw mints a
// throwaway CA per invocation unless SFW_CA_CERT_PATH + SFW_CA_KEY_PATH both
// point at existing files — and a throwaway CA can never live in an OS trust
// store, so every client with its own TLS stack (pnpm's Rust tarball fetcher,
// cargo, uv, go, git) fails UnknownIssuer on a fresh download. The guard is
// evaluated by the SHELL at run time, so one generated wrapper is correct both
// before and after `pnpm run setup:sfw-ca` creates the pair.
//
// LOCKSTEP: byte-identical to `sfwCaPosixExportLines()` /
// `sfwCaWindowsExportLines()` in `.claude/hooks/fleet/_shared/sfw-ca.mts`,
// enforced by `scripts/fleet/check/sfw-ca-env-is-wired.mts`. Inlined rather
// than imported because this file is dep-0 bootstrap: it runs on the system
// Node before node_modules exists, so it cannot import a `.mts`.
const SFW_CA_HOME_RELATIVE_DIR = '.socket/_wheelhouse/ca'
const SFW_CA_POSIX_CERT = `$HOME/${SFW_CA_HOME_RELATIVE_DIR}/socketFirewallCa.crt`
const SFW_CA_POSIX_KEY = `$HOME/${SFW_CA_HOME_RELATIVE_DIR}/socketFirewallCa.key`
const SFW_CA_WINDOWS_CERT = `%USERPROFILE%\\${SFW_CA_HOME_RELATIVE_DIR.replace(/\//g, '\\')}\\socketFirewallCa.crt`
const SFW_CA_WINDOWS_KEY = `%USERPROFILE%\\${SFW_CA_HOME_RELATIVE_DIR.replace(/\//g, '\\')}\\socketFirewallCa.key`

const SFW_CA_POSIX_LINES = [
  '# Socket Firewall persistent CA — point sfw at a STABLE pair so the cert',
  '# can live in the OS trust store. Without it sfw mints a throwaway CA per',
  "# invocation and every non-Node client (pnpm's Rust tarball fetcher,",
  '# cargo, uv, go, git) fails TLS with UnknownIssuer. Guarded: a machine',
  '# that has not run `pnpm run setup:sfw-ca` is left exactly as it was.',
  `if [ -r "${SFW_CA_POSIX_CERT}" ] && [ -r "${SFW_CA_POSIX_KEY}" ]; then`,
  `  export SFW_CA_CERT_PATH="${SFW_CA_POSIX_CERT}"`,
  `  export SFW_CA_KEY_PATH="${SFW_CA_POSIX_KEY}"`,
  'fi',
]

const SFW_CA_WINDOWS_LINES = [
  'rem Socket Firewall persistent CA — see sfwCaPosixExportLines for why.',
  `if not exist "${SFW_CA_WINDOWS_CERT}" goto :sfwcadone`,
  `if not exist "${SFW_CA_WINDOWS_KEY}" goto :sfwcadone`,
  `set "SFW_CA_CERT_PATH=${SFW_CA_WINDOWS_CERT}"`,
  `set "SFW_CA_KEY_PATH=${SFW_CA_WINDOWS_KEY}"`,
  ':sfwcadone',
]

// Env-var sentinel name for a shimmed command's own-recursion guard. The shim
// exports it before handing off to sfw, so a re-entrant invocation — a child
// process the wrapped tool spawns, or the tool re-invoking its OWN name via a
// bare PATH lookup — skips straight to the real binary instead of stripping
// the shared bin dir from PATH. Stripping the WHOLE bin dir (the pre-fix
// shape) took every OTHER racked shim down with it for every child process:
// a child `uv` invocation inside `pnpm run check` fell through to a stale
// Homebrew copy instead of the racked pin, tripping
// path-tools-are-at-pinned-version. Uppercase + non-alnum -> "_" keeps the
// name a valid shell/batch identifier for any future ecosystem command.
export function sentinelVarFor(cmd) {
  return `SOCKET_SHIM_ACTIVE_${cmd.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

// POSIX (bash) body for a real-tool sfw shim: an env-sentinel recursion guard,
// then the trap-and-reap sfw wrap. Mirrors the CI action's "Create sfw shims"
// step (POSIX branch) — keep both in lockstep.
export function posixRealShimLines(cmd, sfwBin, real) {
  const sentinel = sentinelVarFor(cmd)
  return [
    '#!/bin/bash',
    `if [ -n "\${${sentinel}:-}" ]; then`,
    `  exec "${real}" "$@"`,
    'fi',
    `export ${sentinel}=1`,
    // Only sfw-ENTERPRISE parses this (src/sfw-enterprise/config.ts); it is
    // inert for the free build, so setting it unconditionally is safe.
    // Enterprise's built-in default is 'block', which fails dev workflows
    // that reach hosts outside registries[] — and, once
    // SocketDev/firewall#147 lands, a registry hostname that resolves to a
    // LOCAL address (a test mock aliased via /etc/hosts) also becomes an
    // unknown host, so 'block' would newly break those setups too. Setting
    // 'ignore' keeps both working; registry scanning is unaffected either
    // way, since it is decided before the unknown-host policy runs.
    'export SFW_UNKNOWN_HOST_ACTION=ignore',
    // Persistent-CA env pair. INLINED, not imported: this file is the dep-0
    // bootstrap tier (system Node, no node_modules, no type stripping assumed),
    // so it cannot import the canonical
    // `.claude/hooks/fleet/_shared/sfw-ca.mts`. The
    // `sfw-ca-env-is-wired` check compares these lines against that module's
    // `sfwCaPosixExportLines()` byte for byte, so the copy cannot drift.
    ...SFW_CA_POSIX_LINES,
    // uv-only: opt the Socket Firewall into malware scanning of the packages a
    // `uv` install resolves, parallel to the pnpm supply-chain gate. Harmless
    // where unrecognized; enables the check where sfw honors it.
    ...(cmd === 'uv' ? ['export UV_MALWARE_CHECK=1'] : []),
    'set -m',
    `"${sfwBin}" "${real}" "$@" &`,
    'sfw_pid=$!',
    'trap "kill -TERM -$sfw_pid 2>/dev/null" EXIT',
    'trap "kill -INT  -$sfw_pid 2>/dev/null" INT',
    'trap "kill -TERM -$sfw_pid 2>/dev/null" TERM HUP',
    'wait "$sfw_pid"',
    'exit $?',
  ]
}

// Windows (.cmd) body for a real-tool sfw shim: the same sentinel guard, no
// trap-and-reap (batch has no POSIX process groups — see tools.mjs).
// goto/label instead of an `if defined (...)` block: cmd.exe substitutes
// %errorlevel% once at PARSE time for everything inside a single parenthesized
// block, so reading it there would capture the exit code from BEFORE the
// guarded command ran.
export function windowsRealShimLines(cmd, sfwBin, real) {
  const sentinel = sentinelVarFor(cmd)
  return [
    '@echo off',
    `if defined ${sentinel} goto :real`,
    `set "${sentinel}=1"`,
    'set "SFW_UNKNOWN_HOST_ACTION=ignore"',
    ...SFW_CA_WINDOWS_LINES,
    ...(cmd === 'uv' ? ['set "UV_MALWARE_CHECK=1"'] : []),
    `"${sfwBin}" "${real}" %*`,
    'exit /b %errorlevel%',
    ':real',
    `"${real}" %*`,
    'exit /b %errorlevel%',
  ]
}

// Per-command install hint surfaced when a wrapped tool isn't on PATH (the shim
// becomes a helpful-error stub). Mirrors the CI action's hint table.
export function hintFor(cmd) {
  switch (cmd) {
    case 'npm':
      return 'Install Node.js (which provides npm) from https://nodejs.org or via nvm: https://github.com/nvm-sh/nvm'
    case 'yarn':
      return 'Install Yarn from https://yarnpkg.com'
    case 'pnpm':
      return 'Run the fleet setup: `node scripts/fleet/setup/tools.mjs` (installs pnpm via dlx+integrity — the fleet does NOT use corepack).'
    case 'pip':
    case 'pip3':
      return `Install Python (which provides ${cmd}) from https://www.python.org or via brew: brew install python`
    case 'uv':
      return 'Install uv from https://docs.astral.sh/uv/getting-started/installation/'
    case 'cargo':
      return 'Install Rust (which provides cargo) from https://rustup.rs'
    case 'gem':
      return 'Install Ruby (which provides gem) via brew: brew install ruby'
    case 'bundler':
      return 'Install bundler via gem: gem install bundler'
    case 'nuget':
      return 'Install NuGet from https://www.nuget.org/downloads or via brew: brew install nuget'
    case 'go':
      return 'Install Go from https://go.dev/dl or via brew: brew install go'
    default:
      return `Install ${cmd} from your package manager`
  }
}
