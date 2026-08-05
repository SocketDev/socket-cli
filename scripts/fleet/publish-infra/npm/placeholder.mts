#!/usr/bin/env node
/**
 * @file One-time npm name-reservation bootstrap. npm trusted publishing (OIDC)
 *   can only be CONFIGURED for a package name that ALREADY EXISTS on the
 *   registry — but a brand-new package has no name to configure the trusted
 *   publisher against, a chicken-and-egg. This script breaks it: it publishes a
 *   minimal `0.0.0` reservation (a package.json + a one-line README, and
 *   nothing else) to CLAIM the name, so the OIDC trusted-publisher can then be
 *   wired up in the npm UI. Real releases go out via CI afterward (staged +
 *   provenance) — this is the SANCTIONED one-time LOCAL publish, the only
 *   local-publish carve-out in the fleet.
 *   Each name assembles a fresh temp dir containing ONLY those two files (an
 *   empty `files: []` guarantees nothing else ships) and runs
 *   `npm publish --access <access>` from it.
 *   LOCAL ONLY, and enforced here rather than downstream. There is no workflow
 *   for a reservation and there must never be one: everything that publishes
 *   from CI publishes by trusted publishing, and a reservation cannot, because
 *   the name it is claiming does not exist yet. Running under a CI runner is a
 *   policy violation, refused at this entry point so the operator reads the
 *   reason where they typed the command — `auth-posture.mts` refuses the same
 *   shape again at the upload, but that is the backstop, not the message.
 *   CLI: placeholder <name...> [--access public|restricted] [--apply]
 *   Dry-run by default, prints the plan, publishes nothing; `--apply` performs
 *   the publish. Per-name isolation: one name failing never aborts the rest, and
 *   a summary prints at the end. Fail-soft — main() catches, logs, and sets a
 *   non-zero exit code; it never throws.
 *   Usage: node scripts/fleet/publish-infra/npm/placeholder.mts @scope/pkg\
 *   other-pkg --access public --apply
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { runMain } from '../../_shared/run-main.mts'
import { runNpmWebAuth } from '../../npm-web-auth.mts'
import { NAPI_TARGETS_DEFAULT } from '../../util/napi-targets.mts'
import { logger } from '../shared.mts'
import {
  isRunnerContext,
  PLACEHOLDER_RESERVATION_VERSION,
  RUNNER_CONTEXT_ENV_VARS,
} from './auth-posture.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import type { ScriptMeta } from '../../_shared/run-main.mts'

// The reservation version lives with the POLICY that carves it out
// (auth-posture.mts's PLACEHOLDER_RESERVATION_VERSION), not here — the
// carve-out and the publish that uses it cannot be allowed to disagree about
// which version is a reservation.

export type Access = 'public' | 'restricted'

export interface PlaceholderPackageJson {
  name: string
  version: string
  // `false` so npm doesn't refuse the publish outright — a reservation must be
  // publishable, and the point is to claim the name on the public registry.
  private: false
  // Mirror the CLI `--access` into the manifest too, so the reservation's
  // access is self-describing, belt-and-suspenders with the publish flag.
  publishConfig: { access: Access }
  // Empty allow-list: npm still ships the always-included files (package.json +
  // README.md) and NOTHING else — the reservation carries no code.
  files: string[]
}

export interface PlaceholderArgs {
  access: Access
  apply: boolean
  names: string[]
}

export type PlaceholderStatus = 'published' | 'planned' | 'skipped' | 'failed'

export interface PlaceholderResult {
  name: string
  status: PlaceholderStatus
  detail?: string | undefined
}

export interface RunPlaceholderOptions {
  // The publish executor. Defaults to `npm publish --access <access>` run from
  // the temp dir; injected in tests so no real registry call happens.
  publishExec?: ((dir: string, access: Access) => Promise<number>) | undefined
  // Temp-dir assembler; injectable so plan tests can avoid touching disk.
  assembleDir?: ((name: string, access: Access) => Promise<string>) | undefined
  // Temp-dir cleanup; injectable for the same reason.
  removeDir?: ((dir: string) => Promise<void>) | undefined
}

/**
 * Build the reservation package.json for `name` at `access`. Pure — the exact
 * on-disk shape (see PlaceholderPackageJson): name, `0.0.0`, `private: false`,
 * the access, and an empty `files` allow-list so only package.json + README
 * ship.
 */
export function buildPlaceholderPackageJson(
  name: string,
  access: Access,
): PlaceholderPackageJson {
  return {
    name,
    version: PLACEHOLDER_RESERVATION_VERSION,
    private: false,
    publishConfig: { access },
    files: [],
  }
}

/**
 * The one-line reservation README for `name`. Pure. Trailing newline so the
 * file is POSIX-clean. This is the only prose that ships in the reservation.
 */
export function buildPlaceholderReadme(name: string): string {
  return (
    `# ${name}\n\n` +
    'Placeholder to reserve the name for npm trusted publishing. ' +
    'Real releases publish via CI (OIDC/provenance).\n'
  )
}

/**
 * A pragmatic npm package-name gate: length 1–214, no leading `.`/`_`, no
 * uppercase or spaces, url-safe chars; scoped (`@scope/name`) or unscoped. The
 * registry is the final arbiter — this only skips OBVIOUSLY invalid names
 * before we bother assembling + publishing them. Pure.
 */
export function isValidNpmPackageName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) {
    return false
  }
  if (name.trim() !== name) {
    return false
  }
  const segment = '[a-z0-9][a-z0-9._-]*'
  const scoped = new RegExp(`^@${segment}/${segment}$`)
  const unscoped = new RegExp(`^${segment}$`)
  return scoped.test(name) || unscoped.test(name)
}

/**
 * Create a fresh temp dir under `tmpBase` (defaults to the OS temp dir) holding
 * EXACTLY the reservation's package.json + README.md, and return its path. The
 * caller owns cleanup (see runPlaceholder's finally). `tmpBase` is injectable
 * for hermetic tests.
 */
export async function assemblePlaceholderDir(
  name: string,
  access: Access,
  tmpBase: string = os.tmpdir(),
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpBase, 'socket-npm-placeholder-'))
  const pkg = buildPlaceholderPackageJson(name, access)
  await fs.writeFile(
    path.join(dir, 'package.json'),
    `${JSON.stringify(pkg, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(dir, 'README.md'),
    buildPlaceholderReadme(name),
    'utf8',
  )
  return dir
}

/**
 * The refusal text when a reservation is attempted from a CI runner, or
 * undefined when the run is local and may proceed.
 *
 * Pure over `env` so the whole refusal is unit-tested without a runner. The
 * message is written for the operator who typed the command: it names the
 * policy, the variables that gave the run away, and what to do instead.
 */
export function placeholderRunnerRefusal(
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!isRunnerContext(env)) {
    return undefined
  }
  const runners = RUNNER_CONTEXT_ENV_VARS.filter(name => env[name])
  return (
    `Refusing to reserve a name: the ${PLACEHOLDER_RESERVATION_VERSION} placeholder publish is LOCAL-ONLY.\n` +
    `  Where: this process, which has ${runners.join(', ')} set — a CI runner.\n` +
    `  Saw vs wanted: a reservation running inside CI; wanted it run on a machine a human or an agent controls. Everything that publishes from CI publishes by trusted publishing, and a reservation cannot — the name it claims does not exist yet, so no trusted publisher can be configured for it. There is no workflow for this and there must never be one.\n` +
    `  Fix: run it locally — \`node scripts/fleet/publish-infra/npm/placeholder.mts <name> --apply\`. Then configure the OIDC trusted publisher for the claimed name and release every real version through npm-publish.yml.`
  )
}

// Default publish executor: the sanctioned one-time LOCAL publish. Routes
// `npm publish --access <access>`, run from the assembled temp dir, through
// the npm-web-auth PTY wrapper: on a real TTY, or with --otp supplied, the
// wrapper execs npm directly; from a NON-interactive agent shell it allocates
// a PTY so npm's 2FA web-auth flow opens the browser and polls for approval
// instead of dying EOTP once per name, the ajar-reservation incident shape.
async function defaultPublishExec(
  dir: string,
  access: Access,
): Promise<number> {
  // Last line before the registry. main() already refused a runner run with
  // the same text; this catches an importer that reached runPlaceholder
  // directly.
  const refusal = placeholderRunnerRefusal(process.env)
  if (refusal) {
    logger.fail(refusal)
    return 1
  }
  return await runNpmWebAuth({
    argv: ['publish', '--access', access],
    cwd: dir,
    env: process.env,
    isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    platform: process.platform,
  })
}

async function defaultRemoveDir(dir: string): Promise<void> {
  await safeDelete(dir)
}

/**
 * One-line human summary of the run: counts by status, tagged with the mode.
 * Pure — exported for tests.
 */
export function formatSummary(
  results: readonly PlaceholderResult[],
  config: { apply: boolean },
): string {
  const cfg = { __proto__: null, ...config } as { apply: boolean }
  const count = (status: PlaceholderStatus): number =>
    results.filter(r => r.status === status).length
  return (
    `Placeholder ${cfg.apply ? 'publish' : 'dry-run'} summary: ` +
    `${count('published')} published, ${count('planned')} planned, ` +
    `${count('skipped')} skipped, ${count('failed')} failed.`
  )
}

/**
 * Reserve each name, isolated. For every name: validate it (invalid → skipped),
 * assemble its temp dir, then either PRINT the plan (dry-run) or run the
 * publish (`--apply`). A thrown error or non-zero publish exit for one name is
 * recorded as `failed` and never aborts the others; every assembled dir is
 * cleaned up. Logs a summary and returns the per-name results (for tests + the
 * caller's exit-code decision).
 */
export async function runPlaceholder(
  args: PlaceholderArgs,
  options?: RunPlaceholderOptions | undefined,
): Promise<PlaceholderResult[]> {
  const opts = { __proto__: null, ...options } as RunPlaceholderOptions
  const assembleDir = opts.assembleDir ?? assemblePlaceholderDir
  const publishExec = opts.publishExec ?? defaultPublishExec
  const removeDir = opts.removeDir ?? defaultRemoveDir
  const { access, apply, names } = args

  const results: PlaceholderResult[] = []
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (!isValidNpmPackageName(name)) {
      logger.warn(`Skipping invalid npm package name: ${JSON.stringify(name)}`)
      results.push({
        name,
        status: 'skipped',
        detail: 'invalid npm package name',
      })
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const dir = await assembleDir(name, access)
      try {
        if (!apply) {
          logger.log(
            `[dry-run] ${name}@${PLACEHOLDER_RESERVATION_VERSION} — would run ` +
              `\`npm publish --access ${access}\` from ${dir} ` +
              `(package.json + README.md only). Re-run with --apply to publish.`,
          )
          results.push({ name, status: 'planned' })
          continue
        }
        logger.log(
          `Publishing reservation ${name}@${PLACEHOLDER_RESERVATION_VERSION} ` +
            `(--access ${access})…`,
        )
        // eslint-disable-next-line no-await-in-loop
        const code = await publishExec(dir, access)
        if (code === 0) {
          logger.success(
            `Reserved ${name}@${PLACEHOLDER_RESERVATION_VERSION}. Configure the OIDC ` +
              `trusted publisher in the npm UI, then release via CI. ` +
              `A 404 from \`npm view\` right after this is the account's ` +
              `STAGED publishing, not a failed publish — promote the staged ` +
              `package in the npm UI to make the name publicly readable.`,
          )
          results.push({ name, status: 'published' })
        } else {
          logger.fail(`npm publish exited ${code} for ${name}.`)
          results.push({
            name,
            status: 'failed',
            detail: `npm publish exited ${code}`,
          })
        }
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await removeDir(dir)
      }
    } catch (e) {
      logger.error(`${name}: ${errorMessage(e)}`)
      results.push({ name, status: 'failed', detail: errorMessage(e) })
    }
  }

  logger.log('')
  logger.log(formatSummary(results, { apply }))
  return results
}

// A dotted target token after the package's base name means the caller passed
// an implementation/platform package, not a meta-selector — expanding it would
// mint malformed names like `x.node-a.node-b`.
const DOTTED_TARGET_TOKEN_RE = /\.(?:exe|node|wasm)(?:[.-]|$)/

/**
 * Expand a napi meta-selector into its placeholder family: the meta name plus
 * one `.node-<target>` platform package per fleet-default napi target, per the
 * dot-naming grammar `@<owner>/<name>[.<lang>].<target>[-<platform>]`. The
 * platform set derives from the canonical `NAPI_TARGETS_DEFAULT`, so a matrix
 * change reaches reservations automatically. Returns `undefined` when `meta`
 * already carries a target token (the caller named an implementation package,
 * not a family). Pure — exported for tests.
 */
export function expandNapiFamily(meta: string): string[] | undefined {
  if (DOTTED_TARGET_TOKEN_RE.test(meta)) {
    return undefined
  }
  return [meta, ...NAPI_TARGETS_DEFAULT.map(t => `${meta}.node-${t}`)]
}

/**
 * Parse `placeholder <name...> [--access public|restricted] [--napi-family]
 * [--apply]`. `--access` defaults to `public`; dry-run is the default (no
 * `--apply`). Positional args are package names; with `--napi-family` each
 * positional is a napi meta-selector expanded to its full reservation family
 * (meta + the 5 fleet-default `.node-<target>` platform packages), so a
 * family claim is ONE short argument instead of a six-name command line that
 * wraps in a terminal and silently drops names. Exits, usage error, on an
 * unknown flag, a bad `--access` value, a `--napi-family` positional that
 * already carries a target token, or when no names are given.
 */
export function parseArgs(argv: readonly string[]): PlaceholderArgs {
  let access: Access = 'public'
  let apply = false
  let napiFamily = false
  const names: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
    } else if (arg === '--napi-family') {
      napiFamily = true
    } else if (arg === '--access') {
      const v = argv[++i]
      if (v !== 'public' && v !== 'restricted') {
        logger.fail(
          `--access must be 'public' or 'restricted' (saw ${String(v)}).`,
        )
        process.exit(1)
      }
      access = v
    } else if (arg === '--access=public' || arg === '--access=restricted') {
      access = arg.slice('--access='.length) as Access
    } else if (arg.startsWith('-')) {
      logger.fail(`Unknown flag: ${arg}`)
      process.exit(1)
    } else {
      names.push(arg)
    }
  }
  if (names.length === 0) {
    logger.fail(
      'Usage: placeholder <name...> [--access public|restricted] ' +
        '[--napi-family] [--apply]',
    )
    process.exit(1)
  }
  if (napiFamily) {
    const expanded: string[] = []
    for (let i = 0, { length } = names; i < length; i += 1) {
      const name = names[i]!
      const family = expandNapiFamily(name)
      if (!family) {
        logger.fail(
          `--napi-family expands meta-selectors, but ${name} already ` +
            `carries a .node/.exe/.wasm target token. Where: argv. Fix: ` +
            `pass the bare meta name (e.g. @socketsecurity/ajar).`,
        )
        process.exit(1)
      }
      expanded.push(...family)
    }
    return { access, apply, names: expanded }
  }
  return { access, apply, names }
}

export async function main(): Promise<void> {
  // Refuse before anything else — before arg parsing, before a temp dir, before
  // the registry is touched. An operator who ran this in CI reads the reason
  // here, not three layers down in the auth posture.
  const refusal = placeholderRunnerRefusal(process.env)
  if (refusal) {
    logger.fail(refusal)
    process.exitCode = 1
    return
  }
  const args = parseArgs(process.argv.slice(2))
  logger.log(
    `npm placeholder reservation — ${args.names.length} name(s), ` +
      `--access ${args.access}${args.apply ? ' [apply]' : ' [dry-run]'}`,
  )
  const results = await runPlaceholder(args)
  if (results.some(r => r.status === 'failed')) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'publishes minimal 0.0.0 npm name reservations so trusted publishing can be configured (local only)',
  help: `Usage: node scripts/fleet/publish-infra/npm/placeholder.mts <name...> [flags]

  --access <public|restricted>  the npm access level (default public)
  --apply                       perform the publish (dry-run by default)
  --napi-family                 expand each meta name into its napi family`,
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the CLI.
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
