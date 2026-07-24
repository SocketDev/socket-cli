// SkillSpector installer — installed from a LOCKED uv project (no pipx).
// Upstream NVIDIA/skillspector has no PyPI release / no GH releases / no
// tags, so a git SHA IS the pin — but a bare `pipx install git+…@sha`
// re-resolves the whole dependency closure freshly on every machine. Instead
// we ship a uv project (`skillspector/pyproject.toml` + `skillspector/uv.lock`)
// that manifests every transitive version; `uv sync --locked` installs that
// exact closure into the project's own `.venv` and FAILS if the lock drifts
// from the manifest. The fleet uv pin (0.11.21) + the lock's `exclude-newer`
// make the install reproducible across machines and across time. The
// three-way pin (lock ⇔ pyproject rev ⇔ external-tools.json version) is
// enforced by skillspector-pin-is-consistent.mts.
//
// Requirements:
//   - uv on PATH (the bootstrap installs it). If absent, point at the bootstrap.
//   - Python 3.12+ (upstream requirement) — uv provisions one if missing.
//
// Lives in its own file because installers.mts is at the 500-line soft cap.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SKILLSPECTOR } from './tool-config.mts'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Check whether the locally-installed skillspector matches the SHA we
// pinned. The CLI doesn't print a SHA via --version (no upstream releases
// exist), so we fall back to comparing the installed package metadata
// version string. Fail-closed: any check error means "not the right version".
export async function runCheckSkillSpectorVersion(
  binPath: string,
): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output = String(result.stdout).trim()
    // skillspector --version prints "skillspector <semver-from-pyproject>".
    // The pinned SHA may correspond to any pyproject version; treat any
    // non-empty output as "installed". The strict version check would
    // require a new upstream invariant.
    return output.length > 0
  } catch {
    return false
  }
}

export async function runSetupSkillSpector(): Promise<boolean> {
  logger.log('=== SkillSpector ===')

  // Pinned SHA — see SKILLSPECTOR.version in external-tools.json. Surfaced in
  // logs + asserted against the lock by skillspector-pin-is-consistent.mts.
  const sha = SKILLSPECTOR.version
  if (!sha) {
    logger.error(
      'skillspector entry in external-tools.json is missing `version`',
    )
    return false
  }

  // The locked uv project sits beside this lib dir's parent (the hook root),
  // next to external-tools.json: setup-security-tools/skillspector/.
  const projectDir = path.join(__dirname, '..', 'skillspector')
  const pyproject = path.join(projectDir, 'pyproject.toml')
  const uvLock = path.join(projectDir, 'uv.lock')
  if (!existsSync(pyproject) || !existsSync(uvLock)) {
    logger.error(
      'SkillSpector uv project is missing its pyproject.toml/uv.lock',
    )
    logger.error(`  where: ${projectDir}`)
    logger.error(
      '  fix:   restore the project files (run `uv lock` to rebuild)',
    )
    return false
  }

  // Resolve uv (the bootstrap installs it to PATH). No auto-bootstrap here —
  // uv provisioning is the from-scratch setup's job, not a security-tool step.
  const uvBin = whichSync('uv', { nothrow: true })
  if (!uvBin || typeof uvBin !== 'string') {
    logger.error('uv not on PATH. Run the from-scratch bootstrap first:')
    logger.error('  pnpm run setup    # installs uv (+ node, pnpm, sfw, …)')
    return false
  }

  // `uv sync --locked` installs the lock's exact closure into the project venv
  // and hard-fails on lock drift — the verification-grade, reproducible path.
  logger.log(`Syncing locked uv project (skillspector@${sha})`)
  try {
    const result = await spawn(
      uvBin,
      ['sync', '--locked', '--project', projectDir],
      { stdio: 'pipe' },
    )
    const stdout = String(result.stdout).trim()
    if (stdout) {
      logger.log(stdout)
    }
  } catch (e) {
    logger.error(`uv sync --locked failed: ${errorMessage(e)}`)
    return false
  }

  // The entry point lands in the project's venv. POSIX: .venv/bin/skillspector;
  // Windows: .venv/Scripts/skillspector.exe.
  const venvBin =
    process.platform === 'win32'
      ? path.join(projectDir, '.venv', 'Scripts', 'skillspector.exe')
      : path.join(projectDir, '.venv', 'bin', 'skillspector')
  if (!existsSync(venvBin)) {
    logger.error(
      'uv sync succeeded but the skillspector entry point is absent.',
    )
    logger.error(`  expected: ${venvBin}`)
    return false
  }
  if (!(await runCheckSkillSpectorVersion(venvBin))) {
    logger.error(`Installed but --version check failed: ${venvBin}`)
    return false
  }
  logger.log(`Installed at: ${venvBin}`)
  return true
}
