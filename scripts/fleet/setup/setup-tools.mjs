/**
 * @file Local from-scratch tool bootstrap — the LOCAL-dev counterpart of
 *   socket-registry's `.github/actions/setup` composite action, running the
 *   SAME steps via the SAME `lib/` helpers so `local == CI`. On a bare machine
 *   (system Node only, before pnpm / node_modules exist) it:
 *
 *   1. installs pnpm — version + per-platform asset/integrity from the local
 *      `external-tools.json`, downloaded + SRI-verified + extracted by
 *      `lib/install-tool.mjs`. NO corepack.
 *   2. installs Socket Firewall (sfw-free) the same way.
 *   3. regenerates sfw shims (npm/yarn/pnpm/pip/uv/cargo) routing those package
 *      managers through sfw.
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

// PNPM_HOME is the standard pnpm-standalone location; honor it if set so the
// installed pnpm lands where the user's PATH already expects it.
const SOCKET_HOME = path.join(os.homedir(), '.socket')
const PNPM_DIR = process.env.PNPM_HOME || path.join(SOCKET_HOME, 'pnpm')
const SFW_DIR = path.join(SOCKET_HOME, 'sfw-bin')
const SHIM_DIR = path.join(SOCKET_HOME, 'sfw-shim')
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

// Resolve a command's real path with the shim dir stripped from PATH, so we
// wrap the ACTUAL tool (not our own shim). Returns '' when not found.
function resolveReal(cmd) {
  const cleanPath = process.env.PATH.split(path.delimiter)
    .filter(d => d !== SHIM_DIR)
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

// ── 2. sfw (free flavor; local skips the enterprise SKU probe) ───────────────
function installSfw(platform) {
  const version = jq('sfw', 'version')
  const asset = jq('sfw', 'free', 'platforms', platform, 'asset')
  if (!version || !asset) {
    warn(
      `× sfw-free has no asset for ${platform} — skipping sfw (shims become helpful-error stubs)`,
    )
    return undefined
  }
  const integrity = jq('sfw', 'free', 'platforms', platform, 'integrity')
  let binName = jq('sfw', 'free', 'binaryName') || 'sfw'
  if (asset.endsWith('.exe')) {
    binName = `${binName}.exe`
  }
  const sfwBin = path.join(SFW_DIR, binName)
  if (existsSync(sfwBin)) {
    log(`✓ sfw already installed at ${sfwBin}`)
    return sfwBin
  }
  log(`Installing sfw-free@${version} (${asset}) → ${SFW_DIR}`)
  if (
    !installTool(
      `https://github.com/SocketDev/sfw-free/releases/download/v${version}/${asset}`,
      integrity,
      SFW_DIR,
      binName,
    )
  ) {
    warn('× sfw install failed — shims become helpful-error stubs')
    return undefined
  }
  log(`✓ sfw-free@${version} → ${sfwBin}`)
  return sfwBin
}

// ── 3. sfw shims (POSIX) ─────────────────────────────────────────────────────
// Route package managers through sfw. Mirrors the CI action's "Create sfw
// shims" step (POSIX branch). The pnpm not-found hint points at THIS script,
// never corepack (the fleet provisions pnpm via dlx+integrity, not corepack).
function hintFor(cmd) {
  switch (cmd) {
    case 'npm':
      return 'Install Node.js (which provides npm) from https://nodejs.org or via nvm: https://github.com/nvm-sh/nvm'
    case 'yarn':
      return 'Install Yarn from https://yarnpkg.com'
    case 'pnpm':
      return 'Run the fleet setup: `node scripts/fleet/setup/setup-tools.mjs` (installs pnpm via dlx+integrity — the fleet does NOT use corepack).'
    case 'pip':
    case 'pip3':
      return `Install Python (which provides ${cmd}) from https://www.python.org or via brew: brew install python`
    case 'uv':
      return 'Install uv from https://docs.astral.sh/uv/getting-started/installation/'
    case 'cargo':
      return 'Install Rust (which provides cargo) from https://rustup.rs'
    default:
      return `Install ${cmd} from your package manager`
  }
}

function regenerateShims(sfwBin) {
  rmSync(SHIM_DIR, { recursive: true, force: true })
  mkdirSync(SHIM_DIR, { recursive: true })
  const cmds = ['npm', 'yarn', 'pnpm', 'pip', 'pip3', 'uv', 'cargo']
  for (let i = 0, { length } = cmds; i < length; i += 1) {
    const cmd = cmds[i]
    const real = sfwBin ? resolveReal(cmd) : ''
    const shimPath = path.join(SHIM_DIR, cmd)
    if (real && existsSync(real)) {
      // Trap-and-reap shim: run sfw in its own process group, kill the group
      // on any exit so nothing orphans. Matches the CI action's shim body.
      const lines = [
        '#!/bin/bash',
        `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${SHIM_DIR}' | paste -sd: -)"`,
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
  log(`✓ sfw shims → ${SHIM_DIR}`)
  log(`  Add to PATH (if not already): export PATH="${SHIM_DIR}:$PATH"`)
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
  const sfwBin = installSfw(platform)
  regenerateShims(sfwBin)
  bootstrapZeroDepPackages()
  log('✓ setup-tools complete.')
}

main()
