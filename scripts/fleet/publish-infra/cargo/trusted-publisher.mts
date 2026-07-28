#!/usr/bin/env node
/**
 * @file Crates.io Trusted Publishing (GitHub Actions OIDC) configuration for
 *   the workspace's crates. A crates.io trusted publisher binds a crate to one
 *   `owner/repo` + workflow filename + CI environment; the publish job then
 *   exchanges its OIDC token for a short-lived registry token instead of
 *   carrying a long-lived secret. The registry only accepts the exchange when
 *   the claim matches a stored config EXACTLY, so a config naming a workflow
 *   the repo does not have fails at publish time, not at configure time. Every
 *   field is therefore DERIVED, never assumed: the `owner/repo` comes from the
 *   checkout's `origin` remote, and the workflow filename + environment come
 *   from the repo's ACTUAL cargo-publish workflow (the `environment:` key,
 *   including the fleet's `${{ inputs.publish == true && 'cargo-publish' || ''
 *   }}` conditional form). The npm twin shipped hard-coded names once and
 *   configured every package to trust a workflow that did not exist; the OIDC
 *   exchange then 404'd on the first real publish. CLI: trusted-publisher
 *   [<crate>…] [--apply] [--path <dir>] [--repo <owner/name>]
 *   [--workflow <file.yml>] [--environment <name>] With no crate names, every
 *   publishable crate in the workspace is targeted. `--path <dir>` points all
 *   three derivations — the `origin` slug read, the
 *   `.github/workflows/cargo-publish.{yml,yaml}` lookup, and `cargo metadata`
 *   crate discovery — at another checkout, so one copy of this script can
 *   configure any repo; it defaults to the checkout the script lives in.
 *   `--repo <owner/name>` is the separate override for the GitHub slug a config
 *   is stored under, and each flag REFUSES a value shaped like the other's so a
 *   mix-up says which flag to use instead of resolving somewhere unrelated.
 *   Dry-run by default, prints the plan, writes nothing; `--apply` creates the
 *   missing configs. Per-crate isolation: one crate failing never aborts the
 *   rest, and a summary prints at the end. Fail-soft — main() catches, logs,
 *   and sets a non-zero exit code; it never throws. Auth: a crates.io API token
 *   carrying the `trusted-publishing` endpoint scope, read from
 *   `CARGO_REGISTRY_TOKEN` or `~/.cargo/credentials.toml`. The token is sent in
 *   the `authorization` header and never printed or passed on a command line.
 *   Usage: node scripts/fleet/publish-infra/cargo/trusted-publisher.mts
 *   [--path <dir>] --apply.
 */

import { promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { parseGitHubSlug } from '../pin-readme.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { cargoTokenProblem, resolveCratesToken } from './placeholder.mts'
import { readPublishableCargoPackages } from './shared.mts'

// The trusted-publisher collection endpoint. GET lists a crate's configs, POST
// creates one; both take the API token in the `authorization` header and
// require the `trusted-publishing` endpoint scope plus crate ownership.
export const TRUSTPUB_GITHUB_CONFIGS_URL =
  'https://crates.io/api/v1/trusted_publishing/github_configs'

// crates.io rejects requests without a descriptive User-Agent (HTTP 403); this
// identifies the fleet publish tooling per their crawler policy.
const USER_AGENT =
  'socket-wheelhouse-publish (github.com/SocketDev/socket-wheelhouse)'

const REQUEST_TIMEOUT_MS = 20_000

// The printable characters crates.io rejects inside an environment name — they
// would break the claim matching it does at OIDC-exchange time. The registry
// also rejects C0 + DEL control characters, which `environmentProblem` checks
// by code point rather than spelling a control byte into this source file.
const REJECTED_ENVIRONMENT_CHARS = '\'"`,;\\'

// The workflow basenames that carry the fleet's cargo publish job. crates.io
// stores a BASENAME, it rejects a path, so the config's `workflow_filename` is
// exactly one of these.
export const CARGO_PUBLISH_WORKFLOW_BASENAMES = [
  'cargo-publish.yaml',
  'cargo-publish.yml',
]

export interface TrustedPublisherTarget {
  // The CI environment gating the publish job, or undefined when the job runs
  // ungated (crates.io stores `null` for that).
  environment?: string | undefined
  repositoryName: string
  repositoryOwner: string
  workflowFilename: string
}

// A stored config as crates.io returns it (snake_case, `environment` nullable).
export interface GitHubConfigRow {
  crate: string
  environment?: string | null | undefined
  id: number
  repository_name: string
  repository_owner: string
  workflow_filename: string
}

export type TrustedPublisherStatus =
  | 'created'
  | 'failed'
  | 'planned'
  | 'skipped'
  | 'unchanged'

export interface TrustedPublisherResult {
  crate: string
  detail?: string | undefined
  status: TrustedPublisherStatus
}

export interface TrustedPublisherArgs {
  apply: boolean
  crates: string[]
  environment?: string | undefined
  // The `--path <dir>` checkout override, exactly as typed (absolute or
  // relative); `resolveInspectedRoot` resolves it against the caller's cwd.
  path?: string | undefined
  // The `--repo <owner/name>` GitHub slug the stored config names.
  repo?: string | undefined
  workflow?: string | undefined
}

export interface WorkflowSurface {
  environment?: string | undefined
  workflowFilename: string
}

export interface RunTrustedPublisherOptions {
  // Lists a crate's stored configs. Injected in tests so no network call
  // happens.
  listConfigs?:
    | ((crate: string, token: string) => Promise<GitHubConfigRow[]>)
    | undefined
  // Creates one config. Injected in tests for the same reason.
  createConfig?:
    | ((
        crate: string,
        target: TrustedPublisherTarget,
        token: string,
      ) => Promise<GitHubConfigRow>)
    | undefined
}

/**
 * Unwrap a YAML `environment:` value into the environment NAME. Handles the
 * three shapes a fleet workflow uses: a plain scalar (`cargo-publish`), a
 * quoted scalar, and the conditional expression
 * `${{ inputs.publish == true && 'cargo-publish' || '' }}` — whose environment
 * is the first NON-EMPTY quoted literal (the empty literal is the ungated
 * dry-run arm). Returns undefined when no name can be read. Pure — exported
 * for tests.
 */
export function unwrapEnvironmentValue(rawValue: string): string | undefined {
  const raw = rawValue.trim()
  if (raw === '' || raw.startsWith('#')) {
    return undefined
  }
  if (raw.startsWith('${{')) {
    // Every single- or double-quoted literal in the expression, in order. The
    // body of each holds no quote of its own kind, which is all a workflow
    // environment expression ever contains.
    const literals = raw.match(/'[^']*'|"[^"]*"/g) ?? []
    for (let i = 0, { length } = literals; i < length; i += 1) {
      const body = literals[i]!.slice(1, -1).trim()
      if (body !== '') {
        return body
      }
    }
    return undefined
  }
  // A quoted scalar with an optional trailing `# comment`. The back-reference
  // keeps the closing quote the same kind as the opening one.
  const quoted = /^(?<quote>['"])(?<body>.*)\k<quote>[ \t]*(?:#.*)?$/.exec(raw)
  if (quoted) {
    const body = (quoted.groups?.['body'] ?? '').trim()
    return body === '' ? undefined : body
  }
  // A plain scalar, dropping any trailing ` # comment`.
  const plain = raw.replace(/[ \t]+#.*$/, '').trim()
  return plain === '' ? undefined : plain
}

/**
 * The CI environment a workflow's job runs in, read from its first
 * job-level `environment:` key. Accepts the inline form
 * (`environment: cargo-publish`, quoted or a `${{ … }}` expression) and the
 * block form (`environment:` then a more-indented `name: cargo-publish`).
 * Returns undefined when the workflow gates on no environment. Pure —
 * exported for tests.
 */
export function extractWorkflowEnvironment(
  workflowText: string,
): string | undefined {
  const lines = workflowText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // The `environment:` key with its indent and whatever follows on the line.
    const keyMatch = /^(?<indent>[ \t]*)environment:(?<rest>.*)$/.exec(
      lines[i]!,
    )
    if (!keyMatch) {
      continue
    }
    const inline = unwrapEnvironmentValue(keyMatch.groups?.['rest'] ?? '')
    if (inline !== undefined) {
      return inline
    }
    // Block form: scan the more-indented lines beneath the key for `name:`,
    // stopping as soon as the indent returns to the key's level or shallower.
    const indent = (keyMatch.groups?.['indent'] ?? '').length
    for (let j = i + 1; j < length; j += 1) {
      const next = lines[j]!
      if (next.trim() === '') {
        continue
      }
      if (next.length - next.trimStart().length <= indent) {
        break
      }
      // The `name:` child key of an `environment:` block.
      const nameMatch = /^[ \t]*name:(?<value>.*)$/.exec(next)
      if (nameMatch) {
        return unwrapEnvironmentValue(nameMatch.groups?.['value'] ?? '')
      }
    }
  }
  return undefined
}

/**
 * The cargo-publish workflow basename among `filenames`, or undefined when the
 * repo has none. Sorted so the choice is deterministic when a repo somehow
 * carries both the `.yml` and `.yaml` spelling. Pure — exported for tests.
 */
export function pickCargoPublishWorkflow(
  filenames: readonly string[],
): string | undefined {
  return filenames
    .filter(f => CARGO_PUBLISH_WORKFLOW_BASENAMES.includes(f))
    .toSorted()[0]
}

/**
 * Whether `filename` is storable as a crates.io `workflow_filename`, mirroring
 * the registry's own validator: non-empty, at most 255 characters, a `.yml` or
 * `.yaml` suffix, and a BASENAME (no `/`). Pure — exported for tests.
 */
export function isValidWorkflowFilename(filename: string): boolean {
  if (filename.length === 0 || filename.length > 255) {
    return false
  }
  if (!filename.endsWith('.yml') && !filename.endsWith('.yaml')) {
    return false
  }
  return !filename.includes('/')
}

/**
 * A one-line problem with an environment NAME, or undefined when it is
 * storable. Mirrors the registry's validator: non-empty, at most 255
 * characters, no leading/trailing whitespace, and none of the control
 * characters or punctuation in REJECTED_ENVIRONMENT_CHARS. Pure — exported for
 * tests.
 */
export function environmentProblem(environment: string): string | undefined {
  if (environment.length === 0) {
    return 'is empty (omit it instead to configure an ungated publish)'
  }
  if (environment.length > 255) {
    return 'is longer than 255 characters'
  }
  if (environment.trimStart() !== environment) {
    return 'starts with whitespace'
  }
  if (environment.trimEnd() !== environment) {
    return 'ends with whitespace'
  }
  for (let i = 0, { length } = environment; i < length; i += 1) {
    const code = environment.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return 'contains a control character'
    }
    if (REJECTED_ENVIRONMENT_CHARS.includes(environment[i]!)) {
      return `contains ${environment[i]}, which crates.io rejects`
    }
  }
  return undefined
}

/**
 * Whether a stored config already IS the desired target — same repo, workflow,
 * and environment. crates.io stores an ungated publish as `null`, which this
 * treats as equal to an undefined desired environment. Pure — exported for
 * tests.
 */
export function matchesTarget(
  row: GitHubConfigRow,
  target: TrustedPublisherTarget,
): boolean {
  const storedEnvironment = row.environment ?? undefined
  return (
    row.repository_owner === target.repositoryOwner &&
    row.repository_name === target.repositoryName &&
    row.workflow_filename === target.workflowFilename &&
    storedEnvironment === target.environment
  )
}

/**
 * A stored config rendered for the plan output. Pure — exported for tests.
 */
export function formatConfig(
  crate: string,
  target: TrustedPublisherTarget,
): string {
  const environment = target.environment ?? '(none)'
  return (
    `${crate} → ${target.repositoryOwner}/${target.repositoryName} ` +
    `· ${target.workflowFilename} · environment ${environment}`
  )
}

/**
 * The `detail` string crates.io puts in its `{ "errors": [{ "detail": … }] }`
 * error body, or undefined when the body is not that shape. Pure — exported
 * for tests.
 */
export function extractCratesIoErrorDetail(
  bodyText: string,
): string | undefined {
  let parsed: {
    errors?: Array<{ detail?: unknown | undefined }> | undefined
  }
  try {
    parsed = JSON.parse(bodyText) as typeof parsed
  } catch {
    return undefined
  }
  const detail = parsed.errors?.[0]?.detail
  return typeof detail === 'string' && detail ? detail : undefined
}

/**
 * Turn a crates.io HTTP failure into an actionable one-liner: What went wrong,
 * what the registry said, and the fix. The 403s are the ones worth naming —
 * crates.io returns the same status for "no token reached us" and "your token
 * lacks the trusted-publishing scope", and only the second is fixable by
 * minting a new token. Pure — exported for tests.
 */
export function describeHttpFailure(
  status: number,
  detail: string | undefined,
): string {
  const said = detail ?? `HTTP ${status}`
  if (status === 403 && detail?.includes('required permissions')) {
    return (
      `crates.io refused the token: ${said}. Fix: mint a token at ` +
      'crates.io/settings/tokens with the `trusted-publishing` scope (and a ' +
      'crate scope covering this crate), then re-run.'
    )
  }
  if (status === 401 || status === 403) {
    return (
      `crates.io refused the request: ${said}. Fix: confirm ` +
      'CARGO_REGISTRY_TOKEN (or ~/.cargo/credentials.toml) holds a current ' +
      'crates.io token with the `trusted-publishing` scope.'
    )
  }
  if (status === 400) {
    return (
      `crates.io rejected the request: ${said}. Fix: confirm the crate exists ` +
      'and that the token owner is an owner of it.'
    )
  }
  if (status === 404) {
    return (
      `crates.io has no such crate: ${said}. Fix: reserve the name first ` +
      '(scripts/fleet/publish-infra/cargo/placeholder.mts), then configure ' +
      'the trusted publisher.'
    )
  }
  if (status === 429) {
    return `crates.io rate-limited the request: ${said}. Fix: wait, re-run.`
  }
  return `crates.io returned HTTP ${status}: ${said}`
}

// The headers every authenticated crates.io call carries. crates.io takes the
// raw token in `authorization` (no `Bearer` prefix) and 403s a request with no
// descriptive User-Agent.
function authHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: token,
    'user-agent': USER_AGENT,
  }
}

// Re-throw an HTTP failure as an actionable Error; anything else passes
// through unchanged so a network error keeps its own message.
function rethrowActionable(e: unknown): never {
  if (e instanceof HttpResponseError) {
    const detail = extractCratesIoErrorDetail(e.response.body.toString('utf8'))
    throw new Error(describeHttpFailure(e.response.status, detail))
  }
  throw e
}

/**
 * Every trusted-publisher config crates.io stores for `crate`. Requires a token
 * with the `trusted-publishing` scope and ownership of the crate.
 */
export async function listGitHubConfigs(
  crate: string,
  token: string,
): Promise<GitHubConfigRow[]> {
  const url = `${TRUSTPUB_GITHUB_CONFIGS_URL}?crate=${encodeURIComponent(crate)}`
  try {
    const json = await httpJson<{
      github_configs?: GitHubConfigRow[] | undefined
    }>(url, { headers: authHeaders(token), timeout: REQUEST_TIMEOUT_MS })
    return Array.isArray(json.github_configs) ? json.github_configs : []
  } catch (e) {
    return rethrowActionable(e)
  }
}

/**
 * Store one trusted-publisher config for `crate`. crates.io caps a crate at 5
 * configs and rejects a duplicate, so callers list first.
 */
export async function createGitHubConfig(
  crate: string,
  target: TrustedPublisherTarget,
  token: string,
): Promise<GitHubConfigRow> {
  try {
    const json = await httpJson<{
      github_config?: GitHubConfigRow | undefined
    }>(TRUSTPUB_GITHUB_CONFIGS_URL, {
      body: JSON.stringify({
        github_config: {
          crate,
          // crates.io models "no environment gate" as an explicit JSON null;
          // omitting the key is a different request to the registry, whose
          // own schema types this field as string|null.
          // oxlint-disable-next-line socket/prefer-undefined-over-null -- registry wire schema
          environment: target.environment ?? null,
          repository_name: target.repositoryName,
          repository_owner: target.repositoryOwner,
          workflow_filename: target.workflowFilename,
        },
      }),
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      method: 'POST',
      timeout: REQUEST_TIMEOUT_MS,
    })
    if (!json.github_config) {
      throw new Error(
        'crates.io accepted the request but returned no `github_config`.',
      )
    }
    return json.github_config
  } catch (e) {
    return rethrowActionable(e)
  }
}

/**
 * The checkout every derivation reads: the `--path` value resolved against the
 * caller's `cwd`, so a relative path means what the operator typed it from, or
 * this script's own repo root when `--path` is absent. Cascaded copies pass
 * nothing and keep inspecting their own checkout. Pure — exported for tests.
 */
export function resolveInspectedRoot(
  pathArg: string | undefined,
  cwd: string,
): string {
  return pathArg === undefined ? rootPath : path.resolve(cwd, pathArg)
}

/**
 * Whether `value` is shaped like a GitHub `owner/name` slug: two path-free
 * segments, each starting alphanumeric. The leading-character rule is what
 * separates a slug from `./widgets`, `../widgets`, `~/widgets`, and `/widgets`.
 * Pure — exported for tests.
 */
export function isGitHubSlugShape(value: string): boolean {
  return /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(normalizePath(value))
}

/**
 * The refusal for a `--repo` value that is really a filesystem path, or
 * undefined when the value can be read as a GitHub slug. `--repo` names the
 * `owner/name` a stored config points at; `--path` names the checkout to
 * inspect. A path handed to `--repo` would store a config whose OIDC claim
 * nothing ever matches, so it refuses instead. The caller answers the
 * directory-existence question, which keeps this pure — exported for tests.
 */
export function repoFlagMisuse(
  value: string,
  options?: { isExistingDir?: boolean | undefined } | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options } as {
    isExistingDir?: boolean | undefined
  }
  const normalized = normalizePath(value)
  const looksLikePath =
    normalized.startsWith('.') ||
    normalized.startsWith('/') ||
    normalized.startsWith('~')
  if (!looksLikePath && !opts.isExistingDir) {
    return undefined
  }
  return (
    '[cargo-trustpub] --repo takes a GitHub owner/name, not a filesystem ' +
    `path. Where: the --repo argument. Saw: ${value} ` +
    `(${looksLikePath ? 'a path-shaped value' : 'an existing directory'}); ` +
    'wanted: owner/name, for example acme/widgets. Fix: pass ' +
    `--path ${value} to inspect that checkout instead.`
  )
}

/**
 * The refusal for a `--path` value that is really a GitHub slug, or undefined
 * when the value can be read as a directory. A slug handed to `--path` would
 * resolve to an unrelated directory under the caller's cwd, so it refuses. A
 * value that is neither an existing directory nor slug-shaped passes through to
 * the workflow-directory reader, which already names the path it could not
 * read. The caller answers the directory-existence question, which keeps this
 * pure — exported for tests.
 */
export function pathFlagMisuse(
  value: string,
  options?: { isExistingDir?: boolean | undefined } | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options } as {
    isExistingDir?: boolean | undefined
  }
  if (opts.isExistingDir || !isGitHubSlugShape(value)) {
    return undefined
  }
  return (
    '[cargo-trustpub] --path takes a directory, not a GitHub owner/name. ' +
    `Where: the --path argument. Saw: ${value} (slug-shaped, and no such ` +
    'directory); wanted: the checkout to inspect, for example ' +
    `../widgets. Fix: pass --repo ${value} to override the stored ` +
    'owner/name instead.'
  )
}

/**
 * The `owner/repo` slug of the checkout at `cwd`, read from its `origin`
 * remote. Throws LOUD when git fails or the remote is not a GitHub URL — a
 * guessed slug would store a config that silently never matches an OIDC claim.
 */
export async function resolveRepoSlug(cwd: string): Promise<string> {
  const { code, stdout } = await runCapture(
    'git',
    ['remote', 'get-url', 'origin'],
    cwd,
  )
  const slug = code === 0 ? parseGitHubSlug(stdout.trim()) : undefined
  if (!slug) {
    throw new Error(
      '[cargo-trustpub] could not resolve the GitHub repository. Where: the ' +
        `\`origin\` remote of ${cwd}. Saw: ` +
        `${code === 0 ? `a non-GitHub remote (${stdout.trim() || 'empty'})` : `git exited ${code}`}; ` +
        'wanted: a github.com owner/repo URL. Fix: point --path <dir> at the ' +
        'right checkout, or pass --repo <owner/name>.',
    )
  }
  return slug
}

/**
 * The workflow filename + environment the repo's cargo-publish job actually
 * uses. Throws LOUD when the repo has no cargo-publish workflow — configuring
 * a trusted publisher against a workflow that does not exist produces a config
 * whose OIDC exchange fails at publish time, long after this script reported
 * success.
 */
export async function readCargoPublishSurface(
  workflowsDir: string,
): Promise<WorkflowSurface> {
  let entries: string[]
  try {
    entries = await fs.readdir(workflowsDir)
  } catch {
    throw new Error(
      '[cargo-trustpub] could not read the workflows directory. Where: ' +
        `${workflowsDir}. Saw: missing or unreadable; wanted: a ` +
        'cargo-publish workflow to derive the trusted-publisher target from. ' +
        'Fix: point --path <dir> at a repo that has ' +
        '.github/workflows/cargo-publish.yml, or pass --workflow <file.yml> ' +
        '--environment <name>.',
    )
  }
  const workflowFilename = pickCargoPublishWorkflow(entries)
  if (!workflowFilename) {
    throw new Error(
      '[cargo-trustpub] this repo has no cargo-publish workflow. Where: ' +
        `${workflowsDir}. Saw: none of ` +
        `${CARGO_PUBLISH_WORKFLOW_BASENAMES.join(' / ')}; wanted: the ` +
        'workflow whose OIDC claim crates.io will match. Fix: cascade the ' +
        'cargo-publish workflow into that repo first, point --path <dir> at ' +
        'the repo you meant, or pass --workflow <file.yml> ' +
        '--environment <name>.',
    )
  }
  const workflowText = await fs.readFile(
    path.join(workflowsDir, workflowFilename),
    'utf8',
  )
  return {
    environment: extractWorkflowEnvironment(workflowText),
    workflowFilename,
  }
}

/**
 * Assemble the target every crate is configured against, from the repo slug and
 * the workflow surface, with any CLI override applied last. Throws LOUD when a
 * field would not survive crates.io's own validators. Pure — exported for
 * tests.
 */
export function buildTrustedPublisherTarget(
  slug: string,
  surface: WorkflowSurface,
  overrides?:
    | { environment?: string | undefined; workflow?: string | undefined }
    | undefined,
): TrustedPublisherTarget {
  const over = { __proto__: null, ...overrides } as {
    environment?: string | undefined
    workflow?: string | undefined
  }
  const [repositoryOwner, repositoryName] = slug.split('/')
  if (!repositoryOwner || !repositoryName) {
    throw new Error(
      `[cargo-trustpub] the repository slug is malformed. Saw: ${slug}; ` +
        'wanted: owner/name. Fix: pass --repo <owner/name>.',
    )
  }
  const workflowFilename = over.workflow ?? surface.workflowFilename
  if (!isValidWorkflowFilename(workflowFilename)) {
    throw new Error(
      '[cargo-trustpub] the workflow filename is not storable on crates.io. ' +
        `Saw: ${workflowFilename}; wanted: a bare basename ending in .yml or ` +
        '.yaml. Fix: pass --workflow <file.yml>.',
    )
  }
  const environment = over.environment ?? surface.environment
  if (environment !== undefined) {
    const problem = environmentProblem(environment)
    if (problem !== undefined) {
      throw new Error(
        `[cargo-trustpub] the environment name ${problem}. Saw: ` +
          `${JSON.stringify(environment)}; wanted: the CI environment the ` +
          'publish job runs in. Fix: pass --environment <name>.',
      )
    }
  }
  return { environment, repositoryName, repositoryOwner, workflowFilename }
}

/**
 * One-line human summary of the run: counts by status, tagged with the mode.
 * Pure — exported for tests.
 */
export function formatSummary(
  results: readonly TrustedPublisherResult[],
  config: { apply: boolean },
): string {
  const cfg = { __proto__: null, ...config } as { apply: boolean }
  const count = (status: TrustedPublisherStatus): number =>
    results.filter(r => r.status === status).length
  return (
    `Trusted-publisher ${cfg.apply ? 'apply' : 'dry-run'} summary: ` +
    `${count('created')} created, ${count('planned')} planned, ` +
    `${count('unchanged')} unchanged, ${count('skipped')} skipped, ` +
    `${count('failed')} failed.`
  )
}

/**
 * Configure each crate, isolated. For every crate: list its stored configs (an
 * exact match → unchanged), then either PRINT the plan (dry-run) or create the
 * config (`--apply`). A thrown error for one crate is recorded as `failed` and
 * never aborts the others. Logs a summary and returns the per-crate results
 * (for tests + the caller's exit-code decision).
 */
export async function runTrustedPublisher(
  crates: readonly string[],
  target: TrustedPublisherTarget,
  config: { apply: boolean; token: string },
  options?: RunTrustedPublisherOptions | undefined,
): Promise<TrustedPublisherResult[]> {
  const cfg = { __proto__: null, ...config } as {
    apply: boolean
    token: string
  }
  const opts = { __proto__: null, ...options } as RunTrustedPublisherOptions
  const listConfigs = opts.listConfigs ?? listGitHubConfigs
  const createConfig = opts.createConfig ?? createGitHubConfig

  const results: TrustedPublisherResult[] = []
  for (let i = 0, { length } = crates; i < length; i += 1) {
    const crate = crates[i]!
    try {
      // eslint-disable-next-line no-await-in-loop
      const rows = await listConfigs(crate, cfg.token)
      if (rows.some(row => matchesTarget(row, target))) {
        logger.substep(`${formatConfig(crate, target)} — already configured`)
        results.push({ crate, status: 'unchanged' })
        continue
      }
      if (!cfg.apply) {
        logger.substep(`[dry-run] would create ${formatConfig(crate, target)}`)
        results.push({ crate, status: 'planned' })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const created = await createConfig(crate, target, cfg.token)
      logger.success(
        `Configured ${formatConfig(crate, target)} (config #${created.id}).`,
      )
      results.push({ crate, status: 'created' })
    } catch (e) {
      logger.error(`${crate}: ${errorMessage(e)}`)
      results.push({ crate, status: 'failed', detail: errorMessage(e) })
    }
  }

  logger.log('')
  logger.log(formatSummary(results, { apply: cfg.apply }))
  return results
}

// The value-taking flags, so the parser reads one argument after each.
const VALUE_FLAGS = ['--environment', '--path', '--repo', '--workflow']

/**
 * Parse `trusted-publisher [<crate>…] [--apply] [--path <dir>]
 * [--repo <owner/name>] [--workflow <file.yml>] [--environment <name>]`.
 * Dry-run is the default (no `--apply`). `--path` is the checkout to inspect;
 * `--repo` overrides the owner/name the config is stored under. Positional args
 * are crate names; with none, the caller targets every publishable crate in the
 * workspace. Exits, usage error, on an unknown flag or a value-taking flag with
 * no value.
 */
export function parseArgs(argv: readonly string[]): TrustedPublisherArgs {
  let apply = false
  let environment: string | undefined
  let repoPath: string | undefined
  let repo: string | undefined
  let workflow: string | undefined
  const crates: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (VALUE_FLAGS.includes(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) {
        logger.fail(`Flag ${arg} needs a value.`)
        process.exit(1)
      }
      if (arg === '--environment') {
        environment = value
      } else if (arg === '--path') {
        repoPath = value
      } else if (arg === '--repo') {
        repo = value
      } else {
        workflow = value
      }
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      logger.fail(`Unknown flag: ${arg}`)
      process.exit(1)
    }
    crates.push(arg)
  }
  return { apply, crates, environment, path: repoPath, repo, workflow }
}

/**
 * Whether `candidate` names an existing DIRECTORY — the metadata bit is the
 * point, so this stats rather than testing existence. The filesystem half of
 * the `--path` / `--repo` misuse refusals, kept out of the pure matchers so
 * those stay testable without touching disk.
 */
function isExistingDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  // Usage preflight: `--path` and `--repo` are one keystroke apart in intent,
  // and a value handed to the wrong one resolves somewhere unrelated instead of
  // failing. Refuse first, before auth spends a round trip.
  const misuse =
    (args.repo === undefined
      ? undefined
      : repoFlagMisuse(args.repo, {
          isExistingDir: isExistingDirectory(args.repo),
        })) ??
    (args.path === undefined
      ? undefined
      : pathFlagMisuse(args.path, {
          isExistingDir: isExistingDirectory(args.path),
        }))
  if (misuse !== undefined) {
    logger.fail(misuse)
    process.exitCode = 1
    return
  }
  // Auth preflight for BOTH modes: the dry-run reads the registry too, so a
  // malformed saved token would turn into one opaque 403 per crate.
  const token = await resolveCratesToken()
  const problem =
    token === undefined
      ? 'is missing (no env token, no credentials.toml row)'
      : cargoTokenProblem(token)
  if (problem !== undefined || token === undefined) {
    logger.fail(
      `crates.io auth preflight: the token ${problem}. ` +
        'Where: CARGO_REGISTRY_TOKEN, else ~/.cargo/credentials.toml. ' +
        'Fix: mint a token at crates.io/settings/tokens carrying the ' +
        '`trusted-publishing` scope, copy it as the LAST thing on the ' +
        'clipboard (copying a command overwrites it), and pipe: ' +
        'pbpaste | cargo login.',
    )
    process.exitCode = 1
    return
  }

  // The caller's cwd is the anchor ON PURPOSE here: a relative `--path` means
  // what the operator typed it from, and `resolveInspectedRoot` falls back to
  // this script's own root whenever `--path` is absent.
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- resolves the operator-typed relative --path argument from the directory the CLI was invoked in
  const root = resolveInspectedRoot(args.path, process.cwd())
  const slug = args.repo ?? (await resolveRepoSlug(root))
  const surface = args.workflow
    ? { environment: args.environment, workflowFilename: args.workflow }
    : await readCargoPublishSurface(path.join(root, '.github', 'workflows'))
  const target = buildTrustedPublisherTarget(slug, surface, {
    environment: args.environment,
    workflow: args.workflow,
  })

  const crates = args.crates.length
    ? args.crates
    : (await readPublishableCargoPackages(root)).map(p => p.name)
  if (crates.length === 0) {
    logger.fail(
      `[cargo-trustpub] no crates to configure. Where: ${root}. Saw: ` +
        'no publishable package in `cargo metadata`; wanted: at least one. ' +
        'Fix: name the crates explicitly, point --path <dir> at the ' +
        'workspace you meant, or drop `publish = false`.',
    )
    process.exitCode = 1
    return
  }

  logger.log(
    `crates.io trusted publishing — ${crates.length} crate(s)` +
      `${args.apply ? ' [apply]' : ' [dry-run]'}`,
  )
  logger.substep(`path: ${root}`)
  logger.substep(
    `target: ${target.repositoryOwner}/${target.repositoryName} · ` +
      `${target.workflowFilename} · environment ` +
      `${target.environment ?? '(none)'}`,
  )
  const results = await runTrustedPublisher(crates, target, {
    apply: args.apply,
    token,
  })
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
