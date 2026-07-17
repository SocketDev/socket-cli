/*
 * @file Fleet-canonical Go-module publish runner — the Go analog of
 *   cargo-publish.mts / npm-publish.mts. Go publishing is fundamentally
 *   different from crates.io / npm: there is NO registry upload and NO publish
 *   token. A Go module is released by pushing a semver git tag (`vX.Y.Z`, or
 *   `<subdir>/vX.Y.Z` for a nested module); proxy.golang.org fetches it from
 *   VCS, sum.golang.org pins its checksum in an immutable transparency log, and
 *   pkg.go.dev indexes it. So "publish" here is three steps per module:
 *
 *     1. VALIDATE — the module builds/vets clean (`go vet ./...` + `go build
 *        ./...`) so a broken tag never ships.
 *     2. TAG — create + push the annotated semver tag (the tag IS the artifact).
 *     3. VERIFY — poll the public proxy until it serves the EXACT version
 *        (`proxy.golang.org/<module>/@v/<version>.info`), the local mirror of
 *        the go-publish.yml warm-and-verify step.
 *
 *   There is no stage/approve/OTP split — that is a registry-UPLOAD concept with
 *   no Go analog. Instead this mirrors placeholder.mts's ergonomics: DRY-RUN by
 *   default, `--apply` to act, per-module isolation, fail-soft, a summary at the
 *   end — matching the go-publish.yml preset (dry-run unless publish:true). The
 *   default is dry-run because a Go tag is PERMANENT: once proxy.golang.org +
 *   sum.golang.org record a version its checksum is FROZEN, and moving the tag
 *   afterward is a fleet-wide `checksum mismatch` SECURITY ERROR. `--apply` is
 *   the local mirror of the go-publish.yml `go-publish` environment gate.
 *
 *   There is deliberately NO publish-infra/go/placeholder.mts: Go has no name
 *   reservation (the module path IS the already-public repo URL), so the
 *   crates.io/npm "reserve the name for OIDC trusted publishing" bootstrap has
 *   no Go analog. See publish-infra/go/shared.mts for the full rationale.
 *
 *   This file is the thin entry: arg parsing + the per-module run loop. The pure
 *   helpers (tag validation, module resolution, the major-suffix rule, the proxy
 *   verify poll) live in publish-infra/go/shared.mts and are re-exported here so
 *   the go-publish.yml workflow can reuse the unit-tested escapeModulePath. This
 *   script handles no secret — Go publishing is unauthenticated (`git push` uses
 *   the operator's existing credentials; the proxy reads are public).
 *   Usage: node scripts/fleet/go-publish.mts --version X.Y.Z [--module <dir>]…
 *   [--apply]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import {
  buildModuleTag,
  canonicalVersion,
  escapeModulePath,
  isValidReleaseTag,
  majorSuffixError,
  parseModuleDirective,
  parseReleaseTag,
  proxyInfoUrl,
  verifyModuleAvailable,
  versionMajor,
  PUBLIC_GO_PROXY,
} from './publish-infra/go/shared.mts'
import {
  logger,
  rootPath,
  runCapture,
  runInherit,
} from './publish-infra/shared.mts'
import { findGoModFiles } from './update/go.mts'
import { isMainModule } from './_shared/is-main-module.mts'

import type { VerifyResult } from './publish-infra/go/shared.mts'

// Re-export the pure helpers so the go-publish.yml workflow (and tests) can
// reuse the unit-tested implementations from a single import surface. These are
// imported above for local use; the bare `export { … }` re-exports those
// bindings (no duplicate module specifier).
export {
  buildModuleTag,
  canonicalVersion,
  escapeModulePath,
  isValidReleaseTag,
  majorSuffixError,
  parseModuleDirective,
  parseReleaseTag,
  proxyInfoUrl,
  verifyModuleAvailable,
  versionMajor,
}

export type GoPublishStatus = 'published' | 'planned' | 'skipped' | 'failed'

export interface GoPublishArgs {
  apply: boolean
  // Canonical `vX.Y.Z`, or undefined when no --version was given.
  version: string | undefined
  // Explicit `--module <dir>` repo-relative dirs, or [] to auto-discover every
  // first-party go.mod.
  moduleDirs: string[]
}

export interface GoPublishResult {
  dir: string
  status: GoPublishStatus
  detail?: string | undefined
}

/**
 * Injectable process/registry seams. Defaults are the real spawn/git/proxy
 * helpers; tests inject fakes so no runner ever spawns, tags, pushes, or
 * touches the network.
 */
export interface GoPublishSeams {
  // Resolve the repo-relative dirs holding a first-party go.mod ('.' = root).
  discoverModuleDirs?: (() => string[]) | undefined
  // Read a module dir's go.mod `module` path (undefined = no go.mod / directive).
  readModulePath?: ((dir: string) => string | undefined) | undefined
  // Pre-publish validation (`go vet ./...` + `go build ./...`); returns an exit
  // code (0 = clean).
  validate?: ((dir: string) => Promise<number>) | undefined
  // Create + push the annotated tag; returns an exit code (0 = pushed).
  tagAndPush?:
    | ((tag: string, version: string, cwd: string) => Promise<number>)
    | undefined
  // Verify the public proxy serves the exact version.
  verify?:
    | ((modulePath: string, version: string) => Promise<VerifyResult>)
    | undefined
}

/**
 * Discover every first-party go.mod dir under the repo root, repo-relative,
 * with the root module normalized to '.'.
 */
function defaultDiscoverModuleDirs(): string[] {
  return findGoModFiles(rootPath).map(
    file => path.relative(rootPath, path.dirname(file)) || '.',
  )
}

/**
 * Read the `module` directive from `<dir>/go.mod` under the repo root.
 */
function defaultReadModulePath(dir: string): string | undefined {
  const goModPath = path.join(rootPath, dir, 'go.mod')
  if (!existsSync(goModPath)) {
    return undefined
  }
  return parseModuleDirective(readFileSync(goModPath, 'utf8'))
}

/**
 * Default validation: `go vet ./...` then `go build ./...` in the module dir.
 * Returns the first non-zero exit code, or 0 when both pass. Inherited stdio so
 * the toolchain's diagnostics reach the operator.
 */
async function defaultValidate(dir: string): Promise<number> {
  const cwd = path.join(rootPath, dir)
  const vet = await runInherit('go', ['vet', './...'], cwd)
  if (vet !== 0) {
    return vet
  }
  return await runInherit('go', ['build', './...'], cwd)
}

/**
 * Default tag creator: idempotently create the ANNOTATED tag (skip if it
 * already exists locally — never move a published tag) then push it (a
 * tolerated already-pushed push is fine). Runs at the repo root; returns an
 * exit code.
 */
async function defaultTagAndPush(
  tag: string,
  _version: string,
  cwd: string,
): Promise<number> {
  const existing = await runCapture(
    'git',
    ['rev-parse', '-q', '--verify', `refs/tags/${tag}`],
    cwd,
  )
  if (existing.code !== 0) {
    const created = await runInherit(
      'git',
      ['tag', '-a', tag, '-m', `Release ${tag}`],
      cwd,
    )
    if (created !== 0) {
      return created
    }
  } else {
    logger.log(`Tag ${tag} already exists locally; pushing (never re-cutting).`)
  }
  return await runInherit('git', ['push', 'origin', tag], cwd)
}

function defaultVerify(
  modulePath: string,
  version: string,
): Promise<VerifyResult> {
  return verifyModuleAvailable({ modulePath, version })
}

/**
 * One-line human summary of the run: counts by status, tagged with the mode.
 * Pure — exported for tests.
 */
export function formatSummary(
  results: readonly GoPublishResult[],
  mode: { apply: boolean },
): string {
  const count = (status: GoPublishStatus): number =>
    results.filter(r => r.status === status).length
  return (
    `Go module ${mode.apply ? 'publish' : 'dry-run'} summary: ` +
    `${count('published')} published, ${count('planned')} planned, ` +
    `${count('skipped')} skipped, ${count('failed')} failed.`
  )
}

/**
 * Publish (or plan) each module, isolated. For every module dir: read its
 * go.mod module path (missing → skipped), build its release tag from --version
 * (a root module tags `vX.Y.Z`, a nested one `<subdir>/vX.Y.Z`), enforce the
 * semantic-import major-suffix rule, then either PRINT the plan (dry-run) or
 * VALIDATE → TAG+PUSH → VERIFY (`--apply`). A thrown error or non-zero exit for
 * one module is recorded as `failed` and never aborts the others. Logs a
 * summary and returns the per-module results (for tests + the caller's
 * exit-code decision). Fail-soft — never throws.
 */
export async function runGoPublish(
  args: GoPublishArgs,
  seams?: GoPublishSeams | undefined,
): Promise<GoPublishResult[]> {
  const s = { __proto__: null, ...seams } as GoPublishSeams
  const discoverModuleDirs = s.discoverModuleDirs ?? defaultDiscoverModuleDirs
  const readModulePath = s.readModulePath ?? defaultReadModulePath
  const validate = s.validate ?? defaultValidate
  const tagAndPush = s.tagAndPush ?? defaultTagAndPush
  const verify = s.verify ?? defaultVerify
  const { apply } = args
  // Canonicalize the version ONCE (→ vX.Y.Z) so the git tag AND the proxy
  // verify URL use the identical form. main() already validates, but a direct
  // caller (a test) may pass `1.2.3`; undefined = no --version given.
  const version =
    args.version === undefined ? undefined : canonicalVersion(args.version)

  const moduleDirs = args.moduleDirs.length
    ? args.moduleDirs
    : discoverModuleDirs()
  if (moduleDirs.length === 0) {
    logger.log('go-publish: no first-party go.mod found — nothing to do.')
    return []
  }

  const results: GoPublishResult[] = []
  for (let i = 0, { length } = moduleDirs; i < length; i += 1) {
    const dir = moduleDirs[i]!
    try {
      const modulePath = readModulePath(dir)
      if (!modulePath) {
        logger.warn(`Skipping ${dir}: no go.mod / no module directive.`)
        results.push({ dir, status: 'skipped', detail: 'no module directive' })
        continue
      }
      if (args.version === undefined) {
        logger.log(
          `[dry-run] ${dir} (${modulePath}) — pass --version vX.Y.Z to plan a ` +
            `release tag.`,
        )
        results.push({
          dir,
          status: 'skipped',
          detail: 'no --version given',
        })
        continue
      }
      if (!version) {
        logger.fail(`${dir}: --version ${args.version} is not a plain vX.Y.Z.`)
        results.push({ dir, status: 'failed', detail: 'invalid --version' })
        continue
      }
      const tag = buildModuleTag(dir, version)
      if (!tag || !isValidReleaseTag(tag)) {
        logger.fail(
          `${dir}: could not build a valid release tag for ${version}.`,
        )
        results.push({ dir, status: 'failed', detail: 'invalid release tag' })
        continue
      }
      const major = versionMajor(version) ?? 0
      const suffixErr = majorSuffixError(modulePath, major)
      if (suffixErr) {
        logger.fail(`${dir}: ${suffixErr}`)
        results.push({ dir, status: 'failed', detail: suffixErr })
        continue
      }

      if (!apply) {
        logger.log(
          `[dry-run] ${modulePath} — would validate (go vet + build), tag + ` +
            `push ${tag}, then verify ${proxyInfoUrl(PUBLIC_GO_PROXY, modulePath, version)}. ` +
            `Re-run with --apply to publish.`,
        )
        results.push({ dir, status: 'planned' })
        continue
      }

      logger.log(`Validating ${modulePath} (go vet + go build)…`)
      // eslint-disable-next-line no-await-in-loop -- modules publish sequentially.
      const validateCode = await validate(dir)
      if (validateCode !== 0) {
        logger.fail(`${dir}: validation exited ${validateCode}.`)
        results.push({
          dir,
          status: 'failed',
          detail: `validation exited ${validateCode}`,
        })
        continue
      }

      logger.log(`Tagging + pushing ${tag}…`)
      // eslint-disable-next-line no-await-in-loop -- modules publish sequentially.
      const pushCode = await tagAndPush(tag, version, rootPath)
      if (pushCode !== 0) {
        logger.fail(`${dir}: git tag/push exited ${pushCode}.`)
        results.push({
          dir,
          status: 'failed',
          detail: `git tag/push exited ${pushCode}`,
        })
        continue
      }

      logger.log(`Verifying ${modulePath}@${version} on the public proxy…`)
      // eslint-disable-next-line no-await-in-loop -- modules publish sequentially.
      const verified = await verify(modulePath, version)
      if (!verified.ok) {
        logger.fail(`${dir}: ${verified.detail}`)
        results.push({ dir, status: 'failed', detail: verified.detail })
        continue
      }
      logger.success(
        `Published ${modulePath}@${version} (tag ${tag}); ${verified.detail}.`,
      )
      results.push({ dir, status: 'published', detail: verified.detail })
    } catch (e) {
      logger.error(`${dir}: ${errorMessage(e)}`)
      results.push({ dir, status: 'failed', detail: errorMessage(e) })
    }
  }

  logger.log('')
  logger.log(formatSummary(results, { apply }))
  return results
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      module: { multiple: true, type: 'string' },
      version: { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  })

  if (values['help']) {
    logger.log('Usage: go-publish --version X.Y.Z [--module <dir>]… [--apply]')
    logger.log(
      '  (no --apply → dry-run, the default; nothing is tagged/pushed)',
    )
    logger.log('')
    logger.log(
      '  --version X.Y.Z   the release version to tag (vX.Y.Z; the tag IS',
    )
    logger.log('                    the artifact — Go has no registry upload)')
    logger.log(
      '  --module <dir>    repo-relative module dir(s) to publish; repeatable.',
    )
    logger.log(
      '                    Default: every first-party go.mod (root → vX.Y.Z,',
    )
    logger.log('                    nested → <subdir>/vX.Y.Z)')
    logger.log(
      '  --apply           validate → tag + push → verify for real (PERMANENT:',
    )
    logger.log(
      '                    a pushed+indexed tag has a FROZEN checksum)',
    )
    process.exitCode = 0
    return
  }

  const rawVersion =
    typeof values['version'] === 'string' ? values['version'] : undefined
  let version: string | undefined
  if (rawVersion !== undefined) {
    version = canonicalVersion(rawVersion)
    if (!version) {
      logger.fail(
        `--version must be a plain X.Y.Z (or vX.Y.Z); got ${JSON.stringify(rawVersion)}.`,
      )
      process.exitCode = 1
      return
    }
  }

  const rawModule = values['module']
  const moduleDirs = Array.isArray(rawModule)
    ? rawModule
    : typeof rawModule === 'string'
      ? [rawModule]
      : []

  const apply = !!values['apply']
  if (apply && !version) {
    logger.fail('--apply requires --version X.Y.Z (the tag to cut).')
    process.exitCode = 1
    return
  }

  logger.log(
    `Go module publish — ${apply ? '[apply]' : '[dry-run]'}` +
      `${version ? ` ${version}` : ''}`,
  )
  const results = await runGoPublish({ apply, moduleDirs, version })
  if (results.some(r => r.status === 'failed')) {
    process.exitCode = 1
  }
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the CLI.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
