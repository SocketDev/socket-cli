/**
 * @file Shared substrate for the zero-dep from-scratch bootstrap
 *   (setup-tools.mjs + lib/install-<tool>.mjs). Runs on SYSTEM Node BEFORE
 *   node_modules / pnpm exist, so it imports only `node:` builtins + sibling
 *   `.mjs` — never @socketsecurity/lib. Exports the dir layout + the tiny
 *   helpers (jq / installTool / detectPlatform / log / warn) every per-tool
 *   installer shares, so each installer is its own module under the 500-line
 *   cap and `local == CI` (the composite action runs the same code).
 *   Path anchor: constants derive from THIS module's own location
 *   (setup/lib/bootstrap-common.mjs → setupDir = its parent), so they stay
 *   correct no matter which installer imports them.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap: runs before node_modules exists, so the lib spawn wrapper isn't importable; sync child_process is the only option (same constraint as lib/install-tool.mjs).
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// This file lives in setup/lib/; the setup dir (holding external-tools.json +
// the CLI leaf scripts) is one up.
export const LIB = __dirname
export const SETUP_DIR = path.dirname(__dirname)
export const TOOLS_FILE = path.join(SETUP_DIR, 'external-tools.json')

// Walk up from a start dir to the nearest package.json = the repo root the
// bootstrap seeds node_modules into. Dependency-free walk (the fleet
// findUpPackageJson imports @socketsecurity/lib-stable, not on disk yet).
export function findRepoRoot(from) {
  let dir = from
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return from
    }
    dir = parent
  }
}

// _wheelhouse tool layout — Lock-step with @socketsecurity/lib
// src/paths/socket.ts: BIN_DIR == getSocketWheelhouseBinDir() (the one PATH
// entry, flat handles), RACK_DIR == getSocketRackDir() (real binaries racked
// as rack/<tool>/<version>/…). Hard-coded here (not imported) because this
// bootstrap runs before @socketsecurity/lib is on disk.
export const SOCKET_HOME = path.join(os.homedir(), '.socket')
export const WHEELHOUSE_DIR = path.join(SOCKET_HOME, '_wheelhouse')
export const RACK_DIR = path.join(WHEELHOUSE_DIR, 'rack')
export const BIN_DIR = path.join(WHEELHOUSE_DIR, 'bin')
// PNPM_HOME is the standard pnpm-standalone location; honor it if set so the
// installed pnpm lands where the user's PATH already expects it.
export const PNPM_DIR = process.env.PNPM_HOME || path.join(RACK_DIR, 'pnpm')
// sfw racks version-dir'd as rack/sfw/<version>/sfw — the SAME readable path
// install-sfw.mts exposes, so both installers agree.
export const SFW_RACK_DIR = path.join(RACK_DIR, 'sfw')
export const REPO_ROOT = findRepoRoot(__dirname)

export function log(msg) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-pnpm bootstrap; @socketsecurity/lib-stable not installed yet.
  console.log(msg)
}

export function warn(msg) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-pnpm bootstrap; @socketsecurity/lib-stable not installed yet.
  console.error(msg)
}

// Run `node <script> <args...>` and return trimmed stdout, or undefined when
// the script exits non-zero (the lib helpers exit non-zero on missing values).
export function nodeOut(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    return undefined
  }
  return typeof r.stdout === 'string' ? r.stdout.trim() : undefined
}

// Read a tool's value from external-tools.json via the canonical lib/jq.mjs
// reader (the exact path the CI action uses), so local + CI read identically.
// The data lives under the top-level `tools` map ({ tools: { <name>: … } }), so
// callers pass tool-relative keys (`jq('pnpm', 'version')`) and the `tools`
// root is prepended here — the one place that knows the container shape.
export function jq(...keys) {
  return nodeOut(path.join(LIB, 'jq.mjs'), [TOOLS_FILE, 'tools', ...keys])
}

// Canonical platform string via lib/platform.mjs (musl-aware), matching CI.
export function detectPlatform() {
  const p = nodeOut(path.join(LIB, 'platform.mjs'), [])
  if (!p) {
    warn('× could not detect platform (lib/platform.mjs failed)')
    process.exit(1)
  }
  return p
}

// Download + SRI-verify + extract via the canonical lib/install-tool.mjs.
export function installTool(url, integrity, destDir, binName) {
  const args = [url, integrity, destDir]
  if (binName) {
    args.push(binName)
  }
  const r = spawnSync(
    process.execPath,
    [path.join(LIB, 'install-tool.mjs'), ...args],
    { stdio: 'inherit' },
  )
  return r.status === 0
}

// Compare two dotted version strings (`X.Y.Z`) numerically. Dep-free (semver
// isn't on disk in the bootstrap): split on `.`, drop any pre-release/build
// suffix on the patch field, compare segment-by-segment. Returns <0 / 0 / >0
// like a sort comparator. Missing segments count as 0 (`1.2` == `1.2.0`).
export function compareVersions(a, b) {
  const segs = v =>
    String(v)
      .trim()
      .split('.')
      .map(s => Number.parseInt(s, 10) || 0)
  const av = segs(a)
  const bv = segs(b)
  const length = Math.max(av.length, bv.length)
  for (let i = 0; i < length; i += 1) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0)
    if (d !== 0) {
      return d < 0 ? -1 : 1
    }
  }
  return 0
}

// Find the absolute path of the fleet-RACKED binary for a shimmed tool, at the
// version pinned in external-tools.json (pnpm reads engines/the pnpm pin via
// install-pnpm's PNPM_DIR). Returns '' for a tool the fleet does not rack, or
// when the racked binary isn't present on disk yet. Reuses the SAME rack-dir
// layout the per-tool installers write (uv → rack/uv/<ver>/<assetStem>/uv;
// npm → rack/npm/<ver>/package/bin/npm; pnpm → PNPM_DIR/pnpm), so the path is
// never re-invented — drift here would diverge from the installer and is a bug.
export function rackedBinFor(cmd) {
  if (cmd === 'pnpm') {
    const pnpmBin = path.join(PNPM_DIR, 'pnpm')
    return existsSync(pnpmBin) ? pnpmBin : ''
  }
  if (cmd === 'npm') {
    const version = jq('npm', 'version')
    if (!version) {
      return ''
    }
    const npmBin = path.join(RACK_DIR, 'npm', version, 'package', 'bin', 'npm')
    return existsSync(npmBin) ? npmBin : ''
  }
  if (cmd === 'uv') {
    const version = jq('uv', 'version')
    if (!version) {
      return ''
    }
    const verDir = path.join(RACK_DIR, 'uv', version)
    if (!existsSync(verDir)) {
      return ''
    }
    // uv archives wrap the binary in an asset-stem subdir (e.g.
    // `uv-aarch64-apple-darwin/uv`); install-uv.mjs derives that stem from the
    // platform asset. Locate it without re-deriving the asset name: the version
    // dir holds exactly that one subdir.
    const direct = path.join(verDir, 'uv')
    if (existsSync(direct)) {
      return direct
    }
    let entries
    try {
      entries = readdirSync(verDir)
    } catch {
      return ''
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const candidate = path.join(verDir, entries[i], 'uv')
      if (existsSync(candidate)) {
        return candidate
      }
    }
    return ''
  }
  return ''
}

// True on Windows hosts. Shims become `<name>.cmd` batch wrappers (resolved via
// PATHEXT) and the bare-PATH probe uses `where` instead of the POSIX `command -v`.
export const IS_WINDOWS = process.platform === 'win32'

// Write a PATH shim that forwards to a target binary (or `node <entry>`),
// cross-platform (the cmd-shim trio npm uses). A bare POSIX-sh script at
// `<binDir>/<name>` is ALWAYS written — it is the only form on Unix and the form
// Git-Bash / MSYS use on Windows (they search PATH by exact name and ignore
// PATHEXT). On Windows a `<binDir>/<name>.cmd` is added too, which cmd.exe and
// PowerShell resolve for a bare `<name>` via PATHEXT. Pass `exec` for a binary or
// `node` for a `node <entry>` launch; `env` sets vars before the exec in each
// shell's own syntax. Returns the bare shim path.
export function writeShim(binDir, name, options) {
  const opts = { __proto__: null, ...options }
  mkdirSync(binDir, { recursive: true })
  const env = opts.env ?? {}
  const keys = Object.keys(env).toSorted()
  const argv0 = opts.node ? `node "${opts.node}"` : `"${opts.exec}"`
  const shPath = path.join(binDir, name)
  const exports = keys.map(k => `export ${k}="${env[k]}"\n`).join('')
  writeFileSync(shPath, `#!/bin/bash\n${exports}exec ${argv0} "$@"\n`)
  chmodSync(shPath, 0o755)
  if (IS_WINDOWS) {
    const sets = keys.map(k => `set "${k}=${env[k]}"\r\n`).join('')
    writeFileSync(
      path.join(binDir, `${name}.cmd`),
      `@echo off\r\n${sets}${argv0} %*\r\n`,
    )
  }
  return shPath
}

// Mirrors the `which` package's isexe check (the dep-free bootstrap can't import
// it): a real file, plus an execute bit on POSIX. On Windows PATHEXT membership
// is the executability signal, so existence as a file suffices.
function isExecutable(filePath) {
  let st
  try {
    st = statSync(filePath)
  } catch {
    return false
  }
  return st.isFile() && (IS_WINDOWS || (st.mode & 0o111) !== 0)
}

// Resolve a command's real path. For a fleet-RACKED tool (uv / pnpm / npm),
// return the PINNED racked binary's absolute path — so the sfw shim wraps the
// pinned version and a stray Homebrew/corepack copy that wins bare-PATH
// resolution can NEVER shadow it (the bug path-tools-are-at-pinned-version
// guards). For a non-racked tool, fall back to a bare-PATH `command -v` lookup
// with the bin (shim) dir stripped, so we wrap the ACTUAL tool, not our own
// shim. Returns '' when not found.
export function resolveReal(cmd) {
  const racked = rackedBinFor(cmd)
  if (racked) {
    return racked
  }
  // Inline of the `which` algorithm socket-lib's whichSync wraps (the bootstrap
  // is dep-free, so the package itself can't be imported): walk PATH for an
  // executable named `cmd`, honoring Windows PATHEXT, with our own BIN_DIR
  // stripped so we resolve the real tool, not our shim. Shell-free — no
  // subprocess, no injection surface, no DEP0190. First match wins.
  const dirs = process.env.PATH.split(path.delimiter).filter(
    d => d && d !== BIN_DIR,
  )
  const exts = IS_WINDOWS
    ? [
        '',
        ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean),
      ]
    : ['']
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    for (let j = 0, { length: extLen } = exts; j < extLen; j += 1) {
      const candidate = path.join(dirs[i], `${cmd}${exts[j]}`)
      // Skip candidates that are themselves firewall shims (e.g. the legacy
      // ~/.socket/sfw/shims rack, or any other shim dir a machine has on
      // PATH). Stripping only OUR BIN_DIR is not enough: wrapping another
      // shim produces sfw(sfw(tool)) double-wraps and pins whatever stale
      // real-path that shim hardcoded when it was generated.
      if (isExecutable(candidate) && !isFirewallShim(candidate)) {
        return candidate
      }
    }
  }
  return ''
}

// Every Socket firewall shim (this bootstrap's writeShim output AND the legacy
// sfw-native rack's) exports SFW_UNKNOWN_HOST_ACTION near the top of a small
// bash file — a reliable fingerprint that a PATH candidate is a shim, not the
// real tool. Real binaries are ELF/Mach-O/PE (no match) and real launcher
// scripts don't set this sfw-specific knob. Read is capped so sniffing a large
// binary stays cheap; any read error means "not a shim" (fail open — the walk
// then behaves exactly as before).
export function isFirewallShim(filePath) {
  try {
    // Shims are tiny bash files; anything larger is a real binary and is
    // skipped without reading its content.
    if (statSync(filePath).size > 8192) {
      return false
    }
    return readFileSync(filePath, 'utf8').includes('SFW_UNKNOWN_HOST_ACTION')
  } catch {
    return false
  }
}
