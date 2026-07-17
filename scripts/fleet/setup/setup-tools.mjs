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
 *      those package managers through sfw.
 *   4. bootstraps declared zero-dep foundation packages into `node_modules/`
 *      through the shared firewall + lockfile-SRI verifier so root scripts /
 *      .claude/hooks can import them before `pnpm install` runs.
 *      Dependency-free on purpose: it provisions pnpm itself, so it can only
 *      use system Node + `node:` builtins (no `@socketsecurity/lib` — not on
 *      disk yet). Idempotent: re-running with the pinned versions already
 *      installed is a no-op. Accepts `--ci` (reserved; CI calls this same
 *      script via the setup action — currently a no-op locally). Usage: node
 *      setup-tools.mjs [--ci]
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap: runs before node_modules exists, so the lib spawn wrapper isn't importable; sync child_process is the only option (same constraint as lib/install-tool.mjs).
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Shared zero-dep substrate (dir layout + jq/installTool/log/…). Each per-tool
// installer is its own sibling module importing the same substrate, so this
// orchestrator stays small and adding a tool is one new lib/install-<tool>.mjs.
import {
  BIN_DIR,
  compareVersions,
  detectPlatform,
  IS_WINDOWS,
  jq,
  log,
  rackedBinFor,
  REPO_ROOT,
  resolveReal,
} from './lib/bootstrap-common.mjs'
import { installFff } from './lib/install-fff.mjs'
import { installJanus } from './lib/install-janus.mjs'
import { installNpm } from './lib/install-npm.mjs'
import { installPnpm } from './lib/install-pnpm.mjs'
import { installSfw } from './lib/install-sfw.mjs'
import { installSmithers } from './lib/install-smithers.mjs'
import { installUv } from './lib/install-uv.mjs'
import {
  hasSocketToken,
  hintFor,
  posixRealShimLines,
  shimCommands,
  windowsRealShimLines,
} from './setup-tools-sfw.mjs'

// ── 3. sfw shims (POSIX) ─────────────────────────────────────────────────────
// Route package managers through sfw. Mirrors the CI action's "Create sfw
// shims" step (POSIX branch). shimCommands / hintFor / hasSocketToken live in
// ./setup-tools-sfw.mjs (split out for file size).
function regenerateShims(sfwBin, enterprise) {
  // BIN_DIR is the SHARED handle dir (_wheelhouse/bin) — it also holds the
  // sfw / headroom handles, so NEVER rm the whole dir.
  // Just ensure it exists and overwrite the pm-shims in place (idempotent).
  mkdirSync(BIN_DIR, { recursive: true })
  const cmds = shimCommands(enterprise)
  for (let i = 0, { length } = cmds; i < length; i += 1) {
    const cmd = cmds[i]
    const real = sfwBin ? resolveReal(cmd) : ''
    if (IS_WINDOWS) {
      // cmd.exe / PowerShell resolve `<cmd>` to `<cmd>.cmd` via PATHEXT. The
      // POSIX trap-and-reap (process groups, signal traps) has no batch analog,
      // so Windows runs sfw in the foreground and lets the console own cleanup.
      const winShim = path.join(BIN_DIR, `${cmd}.cmd`)
      if (real && existsSync(real)) {
        writeFileSync(
          winShim,
          `${windowsRealShimLines(cmd, sfwBin, real).join('\r\n')}\r\n`,
        )
      } else {
        const lines = [
          '@echo off',
          `echo sfw: "${cmd}" is not installed on this machine. 1>&2`,
          'echo   Install it, then re-run: node scripts/fleet/setup/setup-tools.mjs 1>&2',
          'exit /b 127',
        ]
        writeFileSync(winShim, `${lines.join('\r\n')}\r\n`)
      }
      continue
    }
    const shimPath = path.join(BIN_DIR, cmd)
    if (real && existsSync(real)) {
      // Trap-and-reap shim: run sfw in its own process group, kill the group
      // on any exit so nothing orphans. Matches the CI action's shim body.
      const lines = posixRealShimLines(cmd, sfwBin, real)
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

// ── stale-rack auto-detect ───────────────────────────────────────────────────
// Before the shims are (re)generated, self-heal a tool whose rack is missing or
// stale: a racked/shimmed package manager that resolves on bare PATH BELOW its
// external-tools.json floor (a Homebrew uv@0.9.x, a corepack pnpm) means the
// rack was never installed or was left at an old pin. Re-run that tool's
// installer so resolveReal() can wrap the PINNED racked binary — otherwise the
// sfw shim would wrap the below-floor stray and only trip
// path-tools-are-at-pinned-version later. Returns nothing; installers are
// idempotent (a present, current rack is a no-op).
function refreshStaleRacks(platform) {
  // Map a shimmed tool → its pinned version + the installer that racks it. Only
  // tools the fleet both racks AND version-pins are self-healed; the rest fall
  // through to resolveReal's bare-PATH path unchanged.
  const racked = [
    { installer: () => installPnpm(platform), tool: 'pnpm' },
    { installer: () => installUv(platform), tool: 'uv' },
  ]
  for (let i = 0, { length } = racked; i < length; i += 1) {
    const { installer, tool } = racked[i]
    const pinned = jq(tool, 'version')
    if (!pinned) {
      continue
    }
    const rackBin = rackedBinFor(tool)
    if (rackBin) {
      // Rack present — verify it meets the pin; a sub-pin racked copy is stale.
      const v = spawnSync(rackBin, ['--version'], { encoding: 'utf8' })
      const reported =
        v.status === 0 && typeof v.stdout === 'string'
          ? (/\d+\.\d+\.\d+/.exec(v.stdout)?.[0] ?? '')
          : ''
      if (reported && compareVersions(reported, pinned) >= 0) {
        continue
      }
      log(
        `· ${tool} rack is stale (${reported || '?'} < ${pinned}) — refreshing`,
      )
    } else {
      // No rack on disk; if a bare-PATH copy is below floor it would win the
      // shim — rack the pinned version so it can't.
      const bare = resolveReal(tool)
      if (!bare) {
        continue
      }
      const v = spawnSync(bare, ['--version'], { encoding: 'utf8' })
      const reported =
        v.status === 0 && typeof v.stdout === 'string'
          ? (/\d+\.\d+\.\d+/.exec(v.stdout)?.[0] ?? '')
          : ''
      if (reported && compareVersions(reported, pinned) >= 0) {
        continue
      }
      log(
        `· ${tool} on PATH is ${reported || 'unknown'} (< pin ${pinned}) and not racked — installing pinned version`,
      )
    }
    installer()
  }
}

// ── 4. bootstrap zero-dep packages into node_modules/ ────────────────────────
function bootstrapZeroDepPackages() {
  const script = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'setup',
    'bootstrap-zero-dep-packages.mjs',
  )
  const result = spawnSync(
    process.execPath,
    [script, '--repo-root', REPO_ROOT],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (result.status !== 0) {
    process.exitCode = 1
    throw new Error('zero-dependency package bootstrap failed')
  }
}

function main() {
  // --ci is reserved: CI invokes this same script via the setup action. It is
  // currently a no-op locally (CI/local share the steps below).
  const platform = detectPlatform()
  log(`Platform: ${platform}`)
  const pnpmBin = installPnpm(platform)
  // The just-racked pnpm is NOT yet on PATH. regenerateShims() below wraps the
  // REAL tool via resolveReal(), which resolves through `command -v` on PATH —
  // so prepend the rack pnpm dir now, else the pnpm shim falls back to the
  // "not installed" error stub and `pnpm install` exits 127 (broke release-bundle).
  if (pnpmBin) {
    process.env['PATH'] =
      `${path.dirname(pnpmBin)}${path.delimiter}${process.env['PATH'] ?? ''}`
  }
  // node → pnpm → npm: override node's bundled npm with the pinned, verified
  // version (no self-update) before anything shells out to npm.
  installNpm()
  // Token present (env OR keychain) ⇒ enterprise flavor + its fuller shim set.
  const enterprise = hasSocketToken()
  log(
    `sfw flavor: ${enterprise ? 'enterprise (Socket token found)' : 'free (no token)'}`,
  )
  const sfwBin = installSfw(platform, enterprise)
  // Self-heal any racked/shimmed package manager whose rack is missing or below
  // its external-tools.json floor (e.g. a Homebrew uv shadowing the racked pin)
  // BEFORE the shims are written — so regenerateShims → resolveReal wraps the
  // PINNED racked binary, not the below-floor stray.
  refreshStaleRacks(platform)
  // uv BEFORE regenerateShims: installUv writes a plain exec-the-rack shim
  // (its standalone-bootstrap form), and regenerateShims must run after it so
  // the sfw-wrapped shim is the one that survives — the firewall wrap on uv is
  // the contract (docs/references/sfw-local-install.md §3). uv here also
  // guarantees a hash-locked install for the uv-project tools (SkillSpector's
  // uv.lock) that run after the bootstrap.
  installUv(platform)
  regenerateShims(sfwBin, enterprise)
  installFff(platform)
  installJanus(platform)
  installSmithers()
  bootstrapZeroDepPackages()
  // CI: pnpm + the tool shims live in BIN_DIR, which is NOT on PATH for the
  // later workflow steps. `--ci` persists it via $GITHUB_PATH so the next
  // `pnpm install` step resolves the pnpm shim — a raw `node setup-tools.mjs`
  // without this leaves pnpm unfindable (exit 127, which broke release-bundle).
  if (process.argv.includes('--ci') && process.env['GITHUB_PATH']) {
    appendFileSync(process.env['GITHUB_PATH'], `${BIN_DIR}\n`)
    log(`✓ added ${BIN_DIR} to GITHUB_PATH`)
  }
  log('✓ setup-tools complete.')
}

main()
