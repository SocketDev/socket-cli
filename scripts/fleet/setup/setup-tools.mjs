/**
 * @file Local from-scratch tool bootstrap — the LOCAL-dev counterpart of
 *   socket-registry's `.github/actions/setup` composite action, running the
 *   SAME steps via the SAME `lib/` helpers so `local == CI`. On a bare machine
 *   (system Node only, before pnpm / node_modules exist) it: Tools install
 *   under `~/.socket/_wheelhouse/`: real binaries racked at
 *   `rack/<tool>/<version>/…`, with a flat handle per tool in `bin/` (the one
 *   dir on PATH — the shim IS the bin, npm prefix/bin ⟷ lib/node_modules,
 *   Homebrew bin/ ⟷ Cellar). Steps:
 *
 *   1. installs pnpm — version + per-platform asset/integrity from the local
 *      `external-tools.json`, downloaded + SRI-verified + extracted by
 *      `lib/install-tool.mjs`. NO corepack.
 *   2. installs Socket Firewall (sfw-free) the same way.
 *   3. regenerates sfw shims (npm/yarn/pnpm/pip/uv/cargo) into `bin/`, routing
 *      those package managers through sfw. 3b. installs codedb (Zig
 *      code-intelligence MCP server) + a telemetry-off `bin/codedb` shim
 *      (CODEDB_NO_TELEMETRY=1, always).
 *   4. bootstraps the zero-dep Socket packages into `node_modules/` (direct
 *      tarball + firewall check) so root scripts / .claude/hooks can import
 *      them before `pnpm install` runs. Dependency-free on purpose: it
 *      provisions pnpm itself, so it can only use system Node + `node:`
 *      builtins (no `@socketsecurity/lib` — not on disk yet). Idempotent:
 *      re-running with the pinned versions already installed is a no-op.
 *      Accepts `--ci` (reserved; CI calls this same script via the setup action
 *      — currently a no-op locally). Usage: node setup-tools.mjs [--ci]
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap: runs before node_modules exists, so the lib spawn wrapper isn't importable; sync child_process is the only option (same constraint as lib/install-tool.mjs).
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { existsSync as fsExistsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  hasSocketToken,
  hintFor,
  shimCommands,
} from './setup-tools-sfw.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.join(__dirname, 'lib')
const TOOLS_FILE = path.join(__dirname, 'external-tools.json')

// Walk up from this script to the nearest package.json = the repo root the
// bootstrap seeds node_modules into. Anchored on the script's own location
// (not process.cwd(), unstable) and not a fixed `..` chain (fragile if the
// file moves). Done with a dependency-free walk because this runs BEFORE
// node_modules exists — the fleet `findUpPackageJson` / paths.mts helpers
// import @socketsecurity/lib-stable, which isn't on disk yet.
// oxlint-disable-next-line socket/export-top-level-functions -- pre-pnpm bootstrap; no module boundary worth exporting across before node_modules exists.
function findRepoRoot(from) {
  let dir = from
  for (;;) {
    if (fsExistsSync(path.join(dir, 'package.json'))) {
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
// as rack/<tool>/<version>/…, getSocketRackToolDir). The shim IS the bin — a
// handle in BIN_DIR points at a binary under RACK_DIR (npm prefix/bin ⟷
// lib/node_modules, Homebrew bin/ ⟷ Cellar). Hard-coded here (not imported)
// because this bootstrap runs before @socketsecurity/lib is on disk.
const SOCKET_HOME = path.join(os.homedir(), '.socket')
const WHEELHOUSE_DIR = path.join(SOCKET_HOME, '_wheelhouse')
const RACK_DIR = path.join(WHEELHOUSE_DIR, 'rack')
const BIN_DIR = path.join(WHEELHOUSE_DIR, 'bin')
// PNPM_HOME is the standard pnpm-standalone location; honor it if set so the
// installed pnpm lands where the user's PATH already expects it. Otherwise it
// is racked like every other tool.
const PNPM_DIR = process.env.PNPM_HOME || path.join(RACK_DIR, 'pnpm')
// sfw racks version-dir'd as rack/sfw/<version>/sfw — the SAME readable path
// install-sfw.mts exposes (there as a symlink into the _dlx store), so both
// installers agree and the stale-process-sweeper tracks one sfw path.
const SFW_RACK_DIR = path.join(RACK_DIR, 'sfw')
const REPO_ROOT = findRepoRoot(__dirname)

function log(msg) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-pnpm bootstrap; @socketsecurity/lib-stable not installed yet.
  console.log(msg)
}

function warn(msg) {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-pnpm bootstrap; @socketsecurity/lib-stable not installed yet.
  console.error(msg)
}

// Run `node <script> <args...>` and return trimmed stdout, or undefined when
// the script exits non-zero (the lib helpers exit non-zero on missing values).
function nodeOut(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    return undefined
  }
  return typeof r.stdout === 'string' ? r.stdout.trim() : undefined
}

// Read a value from external-tools.json via the canonical lib/jq.mjs reader
// (the exact path the CI action uses), so local + CI read the data identically.
function jq(...keys) {
  return nodeOut(path.join(LIB, 'jq.mjs'), [TOOLS_FILE, ...keys])
}

// Canonical platform string via lib/platform.mjs (musl-aware), matching CI.
function detectPlatform() {
  const p = nodeOut(path.join(LIB, 'platform.mjs'), [])
  if (!p) {
    warn('× could not detect platform (lib/platform.mjs failed)')
    process.exit(1)
  }
  return p
}

// Download + SRI-verify + extract via the canonical lib/install-tool.mjs.
function installTool(url, integrity, destDir, binName) {
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

// Resolve a command's real path with the bin (shim) dir stripped from PATH, so
// we wrap the ACTUAL tool (not our own shim). Returns '' when not found.
function resolveReal(cmd) {
  const cleanPath = process.env.PATH.split(path.delimiter)
    .filter(d => d !== BIN_DIR)
    .join(path.delimiter)
  const r = spawnSync('command', ['-v', cmd], {
    encoding: 'utf8',
    env: { __proto__: null, ...process.env, PATH: cleanPath },
    // prefer-shell-win32: intentional — `command -v` is a POSIX shell builtin,
    // not an executable, so it MUST run inside a shell on every platform; this
    // local bootstrap targets darwin/linux dev machines.
    shell: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return ''
  }
  return r.stdout.split('\n')[0]?.trim() ?? ''
}

// ── 1. pnpm ────────────────────────────────────────────────────────────────
function installPnpm(platform) {
  const version = jq('pnpm', 'version')
  if (!version) {
    warn('× pnpm version missing from external-tools.json')
    process.exit(1)
  }
  const asset = jq('pnpm', 'platforms', platform, 'asset')
  const integrity = jq('pnpm', 'platforms', platform, 'integrity')
  if (!asset || !integrity) {
    warn(`× pnpm has no asset/integrity for ${platform} at v${version}`)
    process.exit(1)
  }
  const source = jq('pnpm', 'platforms', platform, 'source')
  const binaryRel = jq('pnpm', 'platforms', platform, 'binary')
  const isZip = asset.endsWith('.zip')
  const pnpmBin = path.join(PNPM_DIR, isZip ? 'pnpm.exe' : 'pnpm')

  // Idempotent: pinned version already the active one here?
  if (existsSync(pnpmBin)) {
    const v = spawnSync(pnpmBin, ['--version'], { encoding: 'utf8' })
    if (
      v.status === 0 &&
      typeof v.stdout === 'string' &&
      v.stdout.trim() === version
    ) {
      log(`✓ pnpm@${version} already installed at ${pnpmBin}`)
      return pnpmBin
    }
  }

  const url =
    source === 'npm-registry'
      ? `https://registry.npmjs.org/pnpm/-/${asset}`
      : `https://github.com/pnpm/pnpm/releases/download/v${version}/${asset}`
  log(`Installing pnpm@${version} (${asset}) → ${PNPM_DIR}`)
  if (!installTool(url, integrity, PNPM_DIR)) {
    warn('× pnpm install failed')
    process.exit(1)
  }
  // npm-registry source = a JS tarball, not a native binary: write a wrapper
  // that runs it through the system Node (matches the CI action exactly).
  if (source === 'npm-registry') {
    const binaryPath = path.join(PNPM_DIR, binaryRel || '')
    if (!binaryRel || !existsSync(binaryPath)) {
      warn(`× pnpm npm-registry tarball missing ${binaryRel} after extract`)
      process.exit(1)
    }
    writeFileSync(pnpmBin, `#!/bin/bash\nexec node "${binaryPath}" "$@"\n`)
    chmodSync(pnpmBin, 0o755)
  }
  log(`✓ pnpm@${version} → ${pnpmBin}`)
  return pnpmBin
}

// ── 2. sfw (free vs enterprise SKU, selected by key) ─────────────────────────
// Lock-step with scripts/fleet/install-sfw.mts: both installers read the same
// `tools.sfw-free` / `tools.sfw-enterprise` entries and pick the SKU off the
// same SOCKET_API_KEY/SOCKET_API_TOKEN env keys.
// The two SKUs are separate tools (sfw-free, sfw-enterprise) sharing a binary
// name. Pick the enterprise flavor when a Socket credential is in env (its
// private release assets auth via GITHUB_TOKEN, which install-tool forwards),
// otherwise the public free flavor. Everything — repository, assets, binary
// name — is read from the chosen tool entry, so the URL isn't hardcoded twice.
function installSfw(platform, enterprise) {
  // Flavor decided by the caller via hasSocketToken() (env OR keychain — see
  // setup-tools-sfw.mjs), lock-step with install-sfw.mts. Enterprise's private
  // release assets auth via GITHUB_TOKEN, which install-tool forwards.
  const tool = enterprise ? 'sfw-enterprise' : 'sfw-free'
  const version = jq(tool, 'version')
  const asset = jq(tool, 'platforms', platform, 'asset')
  if (!version || !asset) {
    warn(
      `× ${tool} has no asset for ${platform} — skipping sfw (shims become helpful-error stubs)`,
    )
    return undefined
  }
  const integrity = jq(tool, 'platforms', platform, 'integrity')
  let binName = jq(tool, 'binaryName') || 'sfw'
  if (asset.endsWith('.exe')) {
    binName = `${binName}.exe`
  }
  // repository is `github:<owner>/<repo>` — derive the release-asset URL.
  const repo = String(jq(tool, 'repository') || '').replace(/^github:/, '')
  const sfwVerDir = path.join(SFW_RACK_DIR, version)
  const sfwBin = path.join(sfwVerDir, binName)
  if (existsSync(sfwBin)) {
    log(`✓ sfw already installed at ${sfwBin}`)
    return sfwBin
  }
  log(`Installing ${tool}@${version} (${asset}) → ${sfwVerDir}`)
  if (
    !installTool(
      `https://github.com/${repo}/releases/download/v${version}/${asset}`,
      integrity,
      sfwVerDir,
      binName,
    )
  ) {
    warn('× sfw install failed — shims become helpful-error stubs')
    return undefined
  }
  log(`✓ ${tool}@${version} → ${sfwBin}`)
  return sfwBin
}

// ── 2b. codedb (Zig code-intelligence MCP server) ────────────────────────────
// Raw-binary asset (the asset IS the executable). Racked at
// rack/codedb/<version>/codedb; a bin/codedb shim sets CODEDB_NO_TELEMETRY=1 on
// every invocation (the documented opt-out — telemetry is NEVER on). Skipped
// (no error) when codedb is absent from external-tools.json.
function installCodedb(platform) {
  const version = jq('codedb', 'version')
  const asset = jq('codedb', 'platforms', platform, 'asset')
  if (!version || !asset) {
    log('· codedb not pinned for this platform — skipping')
    return undefined
  }
  const integrity = jq('codedb', 'platforms', platform, 'integrity')
  const destDir = path.join(RACK_DIR, 'codedb', version)
  const codedbBin = path.join(destDir, 'codedb')
  const shimPath = path.join(BIN_DIR, 'codedb')
  if (existsSync(codedbBin)) {
    log(`✓ codedb@${version} already installed at ${codedbBin}`)
  } else {
    log(`Installing codedb@${version} (${asset}) → ${destDir}`)
    if (
      !installTool(
        `https://github.com/justrach/codedb/releases/download/v${version}/${asset}`,
        integrity,
        destDir,
        'codedb',
      )
    ) {
      warn('× codedb install failed — skipping shim')
      return undefined
    }
    log(`✓ codedb@${version} → ${codedbBin}`)
  }
  // Telemetry-off shim: CODEDB_NO_TELEMETRY=1 is non-negotiable.
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(
    shimPath,
    `#!/bin/bash\nexport CODEDB_NO_TELEMETRY=1\nexec "${codedbBin}" "$@"\n`,
  )
  chmodSync(shimPath, 0o755)
  log(`✓ codedb shim → ${shimPath} (CODEDB_NO_TELEMETRY=1)`)
  return codedbBin
}

// ── 3. sfw shims (POSIX) ─────────────────────────────────────────────────────
// Route package managers through sfw. Mirrors the CI action's "Create sfw
// shims" step (POSIX branch). shimCommands / hintFor / hasSocketToken live in
// ./setup-tools-sfw.mjs (split out for file size).
function regenerateShims(sfwBin, enterprise) {
  // BIN_DIR is the SHARED handle dir (_wheelhouse/bin) — it also holds the
  // codedb / sfw / socket-token-minifier handles, so NEVER rm the whole dir.
  // Just ensure it exists and overwrite the pm-shims in place (idempotent).
  mkdirSync(BIN_DIR, { recursive: true })
  const cmds = shimCommands(enterprise)
  for (let i = 0, { length } = cmds; i < length; i += 1) {
    const cmd = cmds[i]
    const real = sfwBin ? resolveReal(cmd) : ''
    const shimPath = path.join(BIN_DIR, cmd)
    if (real && existsSync(real)) {
      // Trap-and-reap shim: run sfw in its own process group, kill the group
      // on any exit so nothing orphans. Matches the CI action's shim body.
      const lines = [
        '#!/bin/bash',
        `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${BIN_DIR}' | paste -sd: -)"`,
        'export SFW_UNKNOWN_HOST_ACTION=ignore',
        'set -m',
        `"${sfwBin}" "${real}" "$@" &`,
        'sfw_pid=$!',
        'trap "kill -TERM -$sfw_pid 2>/dev/null" EXIT',
        'trap "kill -INT  -$sfw_pid 2>/dev/null" INT',
        'trap "kill -TERM -$sfw_pid 2>/dev/null" TERM HUP',
        'wait "$sfw_pid"',
        'exit $?',
      ]
      writeFileSync(shimPath, `${lines.join('\n')}\n`)
    } else {
      // Helpful-error stub for a tool not installed (or no sfw).
      const hint = hintFor(cmd).replace(/'/g, "'\\''")
      const lines = [
        '#!/bin/bash',
        `# Socket Firewall shim — placeholder for ${cmd} (not installed at setup time).`,
        'exec >&2',
        `echo '× sfw: "${cmd}" is not installed on this machine.'`,
        'echo',
        `echo '  ${hint}'`,
        'echo',
        'echo "  Install the tool, then re-run: node scripts/fleet/setup/setup-tools.mjs"',
        'exit 127',
      ]
      writeFileSync(shimPath, `${lines.join('\n')}\n`)
    }
    chmodSync(shimPath, 0o755)
  }
  log(`✓ sfw shims → ${BIN_DIR}`)
  log(`  Add to PATH (if not already): export PATH="${BIN_DIR}:$PATH"`)
}

// ── 4. bootstrap zero-dep packages into node_modules/ ────────────────────────
function bootstrapZeroDepPackages() {
  // A repo with its own bootstrap-from-registry.mts handles all packages.
  if (
    existsSync(path.join(REPO_ROOT, 'scripts', 'bootstrap-from-registry.mts'))
  ) {
    log(
      'Repo has its own bootstrap-from-registry.mts; skipping zero-dep bootstrap.',
    )
    return
  }
  const packages = [
    '@socketregistry/packageurl-js',
    '@sinclair/typebox',
    '@socketsecurity/lib',
    '@socketsecurity/lib-stable',
  ]
  const readPinned = path.join(LIB, 'read-pinned-version.mjs')
  const checkFirewall = path.join(LIB, 'check-firewall.mjs')
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]
    // Already resolvable?
    const resolved = spawnSync(
      process.execPath,
      ['-e', `require.resolve('${pkg}/package.json')`],
      { stdio: 'ignore', cwd: REPO_ROOT },
    )
    if (resolved.status === 0) {
      log(`${pkg} already resolvable; skipping.`)
      continue
    }
    const pinned = nodeOut(readPinned, [pkg])
    if (!pinned) {
      log(`${pkg} not pinned in this repo; skipping.`)
      continue
    }
    let fetchPkg = pkg
    let version = pinned
    if (pinned.includes('\t')) {
      const tab = pinned.indexOf('\t')
      fetchPkg = pinned.slice(0, tab)
      version = pinned.slice(tab + 1)
    }
    // Firewall check — bail loudly on any alert.
    const fw = spawnSync(process.execPath, [checkFirewall, fetchPkg, version], {
      stdio: 'inherit',
    })
    if (fw.status === 1) {
      process.exit(1)
    }
    const base = fetchPkg.includes('/')
      ? fetchPkg.slice(fetchPkg.lastIndexOf('/') + 1)
      : fetchPkg
    const tarballUrl = `https://registry.npmjs.org/${fetchPkg}/-/${base}-${version}.tgz`
    const dest = path.join(REPO_ROOT, 'node_modules', pkg)
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'))
    const tarball = path.join(tmpDir, `${base}.tgz`)
    log(`Bootstrapping ${pkg}@${version} from npm registry…`)
    const dl = spawnSync('curl', ['-fsSL', tarballUrl, '-o', tarball], {
      stdio: 'inherit',
    })
    if (dl.status !== 0) {
      warn(
        `Warning: failed to fetch ${tarballUrl}; pnpm install will resolve it.`,
      )
      rmSync(tmpDir, { recursive: true, force: true })
      continue
    }
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    const x = spawnSync(
      'tar',
      ['-xzf', tarball, '--strip-components=1', '-C', dest],
      { stdio: 'inherit' },
    )
    rmSync(tmpDir, { recursive: true, force: true })
    if (x.status !== 0) {
      warn(`Warning: failed to extract ${pkg}; pnpm install will resolve it.`)
      continue
    }
    log(`✓ ${pkg}@${version} → node_modules/${pkg}`)
  }
}

function main() {
  // --ci is reserved: CI invokes this same script via the setup action. It is
  // currently a no-op locally (CI/local share the steps below).
  const platform = detectPlatform()
  log(`Platform: ${platform}`)
  installPnpm(platform)
  // Token present (env OR keychain) ⇒ enterprise flavor + its fuller shim set.
  const enterprise = hasSocketToken()
  log(
    `sfw flavor: ${enterprise ? 'enterprise (Socket token found)' : 'free (no token)'}`,
  )
  const sfwBin = installSfw(platform, enterprise)
  regenerateShims(sfwBin, enterprise)
  installCodedb(platform)
  bootstrapZeroDepPackages()
  log('✓ setup-tools complete.')
}

main()
