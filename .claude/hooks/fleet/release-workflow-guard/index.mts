#!/usr/bin/env node
// Claude Code PreToolUse hook — release-workflow-guard.
//
// Risk-tiered policy on Bash commands that would dispatch a GitHub
// Actions workflow. The risk that matters is reversibility:
//
//   - npm publish: irreversible after the 24h unpublish window. The
//     package version is locked forever. Block always.
//   - GitHub release: reversible via `gh release delete <tag>
//     --cleanup-tag`. The downstream blast radius is bounded by who
//     pulled the release before deletion. Allowable.
//   - Container image push: effectively irreversible (registries
//     conventionally treat image tags as immutable). Block.
//
// Hook decision tree, in order:
//
//   1. Verifiable dry-run? (`-f dry-run=true` + workflow declares
//      `dry-run:` input + no force-prod override) → ALLOW.
//   2. GitHub-release-only workflow? (workflow YAML never calls
//      `npm/pnpm/yarn publish`, does call `gh release create` /
//      release action, and command has no force-prod override)
//      → ALLOW.
//   3. Anything else (npm-publishing workflow, force-prod override,
//      unclassifiable workflow, `gh api .../dispatches` shape) → BLOCK.
//
// The npm-publish detector triggers on `npm publish`, `pnpm publish`,
// `yarn publish`, and `JS-DevTools/npm-publish` action references in
// the workflow YAML. The GH-release detector triggers on
// `gh release create`, `softprops/action-gh-release`, and
// `ncipollo/release-action`. Both run with whitespace tolerance.
//
// Force-prod overrides keep blocking even for GH-only workflows:
// `-f release=true`, `-f publish=true`, `-f prod=true`,
// `-f production=true`. These flip a workflow back into "do the prod
// thing" — a GH-release-only workflow that takes `publish=true` may
// be wired to also npm-publish in that branch.
//
// Recovery (when a wrong release lands):
//   - `gh release delete <tag> --cleanup-tag --yes`
//     (drops the GH release and the git tag in one command)
//
// Exit code 2 with a clear stderr message stops the tool call. The
// model never gets to fire the command. The user re-runs it from
// their own terminal (or via the GitHub Actions UI) when ready.
//
// Blocked patterns:
//   - `gh workflow run <id>`
//   - `gh workflow dispatch <id>` (alias of `run`)
//   - `gh api ... actions/workflows/<id>/dispatches` POST/PUT
//     (the gh-api shape never bypasses; it takes inputs as a JSON
//      body which is harder to verify safely. Route through user.)
//
// Operational rules paired with the SKILL ("updating-node" Phase 5):
//   - Cap of 2 live releases per artifact in flight. Before
//     dispatching a 3rd, delete the oldest tag+release. Keeps one
//     prior release as a validation safety net.
//   - Before dispatching a release workflow, bump the corresponding
//     `.github/cache-versions.json` entry. Otherwise the workflow
//     hits a stale cache and re-publishes a stale binary.
//
// The hook recognizes only kebab-case `dry-run` as the input name —
// see CLAUDE.md "Workflow input naming" for the rule. If a workflow
// declares `dry_run` (snake) or any other shape, the verification
// fails and the bypass doesn't apply. Fix the workflow.
//
// This hook is the enforcement layer paired with the CLAUDE.md
// rule. The rule documents the policy; the hook makes it
// mechanical so the model can't accidentally dispatch a workflow
// even when reasoning about urgent release work.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  bashGuard,
  block,
  defineHook,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { commandsFor, parseCommands } from '../_shared/shell-command.mts'
import { bypassPhraseRemaining } from '../_shared/transcript.mts'

// Pre-flight triggers: the dispatcher imports + runs this guard only when the
// raw command contains at least one of these substrings. They mirror
// `detectDispatch`'s own cheap gate exactly — a command with neither `workflow`
// nor `dispatches` can never reach a block/notify verdict (the two dispatch
// shapes are `gh workflow run/dispatch <id>` and
// `gh api .../actions/workflows/<id>/dispatches`). Keep in lock-step with that
// gate: narrowing this set would silently disable the guard.
export const triggers: readonly string[] = ['dispatches', 'workflow']

// Bypass phrase: `Allow workflow-dispatch bypass: <workflow>`.
// Authorizes EXACTLY ONE dispatch of the named workflow when the
// user types the phrase verbatim in a recent turn. Re-dispatching
// the same workflow needs a fresh phrase. Dispatching a different
// workflow needs its own phrase.
//
// Why per-workflow + per-trigger: an earlier shape just matched the
// bare string `Allow workflow-dispatch bypass`, which authorized
// every dispatch in the next 8 user turns. That was too permissive
// — one phrase shouldn't open the door for an unrelated workflow
// later in the session. The colon-suffix form names the workflow
// being authorized so each phrase consumes one specific dispatch.
//
// `<workflow>` is the literal token passed to `gh workflow run` —
// either the workflow filename (`publish.yml`), the basename
// (`publish`), or the workflow ID (`12345`). The matcher accepts
// any of those three shapes for the same workflow because the user
// might write whichever feels natural.
//
// Use cases that need the bypass (the dry-run path doesn't cover):
//   - Workflows that don't accept a `dry-run` input by design
//     (e.g. node-smol's main build, which has 30-minute side effects
//     but no inverse).
//   - One-off recovery dispatches after a stuck job.
//   - Re-dispatches after a transient infra failure (cache miss,
//     runner timeout) where the user has already verified the
//     previous run's intent.
//
// Once-and-done: once the hook authorizes a dispatch against a
// phrase, that exact phrase doesn't authorize a second dispatch.
// Implementation note: we don't write to disk to track consumption —
// instead the test "is this phrase present AFTER my last dispatch
// of this workflow" answers it. See `findUnclaimedBypassPhrase`.
const BYPASS_PHRASE_PREFIX = 'Allow workflow-dispatch bypass:'
const BYPASS_LOOKBACK_USER_TURNS = 8

/**
 * Build the canonical phrase variants that authorize ONE dispatch of
 * `workflow`. The user can name the workflow in any of three shapes — the
 * filename, the basename (drop `.yml` / `.yaml`), or the numeric workflow id —
 * and any of them counts.
 */
export function buildAcceptedPhrases(workflow: string): readonly string[] {
  const stripped = workflow.replace(/\.(?:yaml|yml)$/i, '')
  // De-duplicate when filename and basename collapse to the same
  // string (the workflow target was already stripped).
  const tokens = stripped === workflow ? [workflow] : [workflow, stripped]
  return tokens.map(token => `${BYPASS_PHRASE_PREFIX} ${token}`)
}

/**
 * Count past `gh workflow run/dispatch` invocations targeting `workflow` in the
 * assistant tool-use history. Each prior dispatch consumes one bypass phrase,
 * so the per-trigger guard requires `phraseCount > priorDispatchCount`.
 *
 * Walks the transcript JSONL directly — `_shared/transcript.mts` exposes
 * `readLastAssistantToolUses` for the most-recent turn only, but here we need
 * the full history. Best-effort: malformed lines are skipped silently.
 */
export function countPriorDispatches(
  transcriptPath: string | undefined,
  workflow: string,
): number {
  if (!transcriptPath || !workflow) {
    return 0
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return 0
  }
  // oxlint-disable-next-line socket/sort-set-args -- two derived forms of one workflow name (the value + its extension-stripped form); Set membership order is immaterial.
  const accepted = new Set([workflow, workflow.replace(/\.(?:yaml|yml)$/i, '')])
  let count = 0
  const lines = raw.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line) {
      continue
    }
    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    // Look at assistant tool-use blocks only — the user's Bash
    // calls (if any) don't count, and our own future calls are
    // not yet in the transcript when this hook runs.
    if (
      !evt ||
      typeof evt !== 'object' ||
      (evt as Record<string, unknown>)['type'] !== 'assistant'
    ) {
      continue
    }
    const message = (evt as Record<string, unknown>)['message']
    if (!message || typeof message !== 'object') {
      continue
    }
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) {
      continue
    }
    for (let j = 0, blocksLen = content.length; j < blocksLen; j += 1) {
      const block = content[j]
      if (!block || typeof block !== 'object') {
        continue
      }
      const b = block as Record<string, unknown>
      if (b['type'] !== 'tool_use' || b['name'] !== 'Bash') {
        continue
      }
      const cmd = (b['input'] as Record<string, unknown> | undefined)?.[
        'command'
      ]
      if (typeof cmd !== 'string') {
        continue
      }
      const dispatch = detectDispatch(cmd)
      if (dispatch.workflow && accepted.has(dispatch.workflow)) {
        count += 1
      }
    }
  }
  return count
}

// Flags on `gh workflow run/dispatch` that take a value argument — so
// the value isn't mistaken for the workflow target. `gh workflow run
// publish.yml -f dry-run=true --ref main` → target is `publish.yml`.
const GH_WORKFLOW_VALUE_FLAGS = new Set([
  '--field',
  '--json',
  '--raw-field',
  '--ref',
  '--repo',
  '-F',
  '-f',
  '-R',
  '-r',
])

// `gh api` path that names a workflow dispatch endpoint:
// `.../actions/workflows/<id>/dispatches`. The path component implies
// dispatch — no need to also inspect -X.
const GH_API_DISPATCH_PATH_RE =
  /\/actions\/workflows\/(?<workflowId>[^/\s]+)\/dispatches\b/

// Dry-run input detection. The fleet standardized on `dry-run`
// (kebab-case) — see socket-registry's shared actions and every
// `*.yml` workflow that takes a dispatch input. Match values
// "true"/"1"/"yes" as truthy and "false"/"0"/"no" as falsy. Quote-
// mask handling lives in detectDispatch; these regexes scan the
// same masked range as the dispatch detector.
const DRY_RUN_TRUE_RE = /-f\s+dry-run\s*=\s*['"]?(?:1|true|yes)['"]?/i
const DRY_RUN_FALSE_RE = /-f\s+dry-run\s*=\s*['"]?(?:0|false|no)['"]?/i

// Inputs that flip a workflow back into "do the prod thing." Even
// with dry-run=true, if any of these are explicitly set the dispatch
// is no longer benign — block. Order matters: this runs after
// dry-run detection, so an explicit publish=true overrides.
const FORCE_PROD_INPUTS_RE =
  /-f\s+(?:prod|production|publish|release)\s*=\s*['"]?(?:1|true|yes)['"]?/i

// Workflow YAML input declaration. Match the canonical
// `dry-run:` line under `inputs:` — used to verify a workflow
// actually accepts a dry-run override before allowing a dispatch
// that claims to use it. Tolerates leading whitespace (any
// indentation) since YAML nesting depth varies by file.
const WORKFLOW_DRY_RUN_INPUT_RE = /^\s+dry-run:\s*$/m

// npm-publish detector. A workflow that contains any of these tokens
// publishes to npm — irreversible after the 24h unpublish window.
// Always block these dispatches unless the user runs them themselves.
//   - `npm publish` / `pnpm publish` / `yarn publish` (CLI)
//   - `JS-DevTools/npm-publish` (popular publish action)
// The whitespace tolerance handles `pnpm  publish` and `npm     publish`
// found in real workflow YAML.
const WORKFLOW_NPM_PUBLISH_RE =
  /\b(?:npm|pnpm|yarn)\s+publish\b|JS-DevTools\/npm-publish/i

// GitHub-release detector. A workflow that creates a GH release but
// never npm-publishes is allowed live (dispatch can be re-run, prior
// releases can be deleted via `gh release delete`). Recognize both
// the `gh release create` CLI and the standard release actions.
const WORKFLOW_GH_RELEASE_RE =
  /\bgh\s+release\s+create\b|softprops\/action-gh-release|ncipollo\/release-action/i

// `--repo <owner>/<name>` parser. Captures the repo name (after the
// slash). Used to gate the dry-run bypass: a dispatch targeting a
// repo other than the current $CLAUDE_PROJECT_DIR can't be verified
// from disk, so we conservatively block it.
const GH_REPO_FLAG_RE = /\s--repo\s+\S*?\/(?<repoName>[^\s/]+)/

// Inline `cd <path> && …` parser. Captures the destination path so
// the search-roots resolver can include it. Claude Code's Bash tool
// invokes PreToolUse hooks with cwd = the session's project dir
// (not the cwd the chained command will switch to), so without this
// parse the hook can't locate a workflow YAML that lives in the
// sibling clone the user is targeting via `cd`. The path may be
// quoted ("..." or '...'); strip the quotes for the resolver.
const INLINE_CD_RE =
  /(?:^|[;&])\s*cd\s+(?:'(?<sq>[^']+)'|"(?<dq>[^"]+)"|(?<bare>\S+))\s*&&/

type DispatchResult = {
  // When `blocked` is false, populated with the reason the dispatch
  // was allowed through. Surfaced in the hook's "allowed" log line so
  // the user can see exactly why the guard let it pass.
  allowedReason?: string | undefined
  blocked: boolean
  shape?: string | undefined
  workflow?: string | undefined
}

// Resolve the workflow file path and verify it actually declares a
// `dry-run` input. The path is resolved relative to
// `$CLAUDE_PROJECT_DIR/.github/workflows/<workflow>` since the hook
// runs from arbitrary cwds; falls back to ".github/workflows/<wf>"
// when the env var is unset (e.g. the hook invoked outside Claude
// Code). The check is intentionally permissive: any unparseable
// workflow file is treated as "no dry-run input" (block-the-default).
//
// `searchRoots` is the list of project directories to probe. The
// caller picks exactly one based on the dispatch shape:
//   - same-repo (no --repo, or --repo names the current project):
//     just the current project dir.
//   - cross-repo (--repo names a different project): just the
//     sibling clone at <parent-of-project-dir>/<name>. The current
//     project is intentionally excluded so a same-named workflow in
//     the current checkout can't false-positive a cross-repo dispatch.
// Classify a workflow file by its release shape:
//   - 'npm'    — runs `npm/pnpm/yarn publish` somewhere; irreversible
//   - 'gh'     — only creates GitHub releases (reversible via
//                `gh release delete`)
//   - 'unknown' — no detected release shape (file unreadable, or
//                workflow does something the classifier can't see)
//
// The hook treats 'gh' as eligible for live dispatch (after other
// gates pass) and treats 'npm' / 'unknown' as block-the-default.
export function classifyWorkflow(
  workflow: string,
  searchRoots: readonly string[],
): 'npm' | 'gh' | 'unknown' {
  if (!/\.(?:yaml|yml)$/i.test(workflow)) {
    return 'unknown'
  }
  const filename = path.basename(workflow)
  for (let i = 0, { length } = searchRoots; i < length; i += 1) {
    const root = searchRoots[i]!
    const fullPath = path.join(root, '.github', 'workflows', filename)
    if (!existsSync(fullPath)) {
      continue
    }
    try {
      const yaml = readFileSync(fullPath, 'utf8')
      // npm-publish wins if both signals appear — a workflow that
      // both creates a GH release AND publishes to npm is still
      // irreversible at the npm step.
      if (WORKFLOW_NPM_PUBLISH_RE.test(yaml)) {
        return 'npm'
      }
      if (WORKFLOW_GH_RELEASE_RE.test(yaml)) {
        return 'gh'
      }
      // File exists but neither signal — fall through to next root.
    } catch {
      // Read error — try next root.
    }
  }
  return 'unknown'
}

export function workflowDeclaresDryRunInput(
  workflow: string,
  searchRoots: readonly string[],
): boolean {
  // Workflow arg can be "id.yml", "name.yaml", a numeric ID, or a path.
  // Numeric IDs and paths-without-extension can't be resolved without
  // hitting GitHub's API — for those, conservatively return false.
  if (!/\.(?:yaml|yml)$/i.test(workflow)) {
    return false
  }
  // Strip any leading directory prefix the user passed (e.g. they
  // typed the path explicitly). The bare filename is what
  // .github/workflows/ holds.
  const filename = path.basename(workflow)
  for (let i = 0, { length } = searchRoots; i < length; i += 1) {
    const root = searchRoots[i]!
    const fullPath = path.join(root, '.github', 'workflows', filename)
    if (!existsSync(fullPath)) {
      continue
    }
    try {
      const yaml = readFileSync(fullPath, 'utf8')
      if (WORKFLOW_DRY_RUN_INPUT_RE.test(yaml)) {
        return true
      }
      // File exists but no dry-run input — fall through to next root.
      // (Same-name workflow may exist in multiple sibling repos with
      // different shapes; only one needs to satisfy the verification.)
    } catch {
      // Read error — try next root.
    }
  }
  return false
}

// Decide whether a dispatch on `workflow` should be allowed because
// it's a verifiable dry-run. All four conditions must hold:
//   1. `-f dry-run=true|1|yes` is explicitly present in the command
//   2. `-f dry-run=false|0|no` is NOT present (user didn't override)
//   3. No force-prod input is present (release/publish/prod=true)
//   4. The target workflow YAML declares a `dry-run:` input under
//      its `workflow_dispatch.inputs` block — without that, the gh
//      CLI silently accepts the flag but the workflow ignores it.
//
// The workflow lookup probes the current project first, then any
// sibling clone implied by `--repo owner/<name>`. Sibling clones
// follow the fleet convention: `<projects-dir>/<repo-name>` next to
// the current project. If the file isn't readable from any local
// checkout, the bypass denies — same posture as a missing file.
// Resolve the workflow file's search roots based on the command's
// --repo flag. Used by both bypasses (dry-run + GH-release-only).
//   - same-repo (no --repo, or --repo names the current project):
//     the current project dir, plus `process.cwd()` when it differs.
//     The cwd fallback covers the cross-session case where one Claude
//     session has CLAUDE_PROJECT_DIR pointing at repo A, but the user
//     `cd`-ed into sibling repo B before invoking `gh workflow run`
//     against a workflow that lives in B. Without the cwd fallback
//     the hook would block the bypass because A's YAML doesn't
//     declare the dry-run input that B's does.
//   - cross-repo (--repo names a different project): just the sibling
//     clone at <parent-of-project-dir>/<name>. The current project is
//     intentionally excluded so a same-named workflow in the current
//     checkout can't false-positive a cross-repo dispatch.
export function resolveSearchRoots(command: string): string[] {
  // Resolution order: $CLAUDE_PROJECT_DIR (Claude Code sets this when
  // it remembers to) → derive from this module's own path (the hook
  // lives at <project>/.claude/hooks/fleet/release-workflow-guard/index.mts,
  // so go four levels up from its directory) → $PWD as last resort.
  // The module-path derivation is the most robust because it doesn't
  // depend on the runner exporting env vars correctly, and — unlike the
  // launched-script path — points at THIS file even when many guards
  // share one dispatcher process.
  let projectDir = process.env['CLAUDE_PROJECT_DIR']
  if (!projectDir) {
    // import.meta.url is this module's URL; resolve to the absolute
    // hook-script path and walk up to the repo root. Matches the prior
    // launched-script-path derivation level-for-level.
    const scriptPath = fileURLToPath(import.meta.url)
    // .claude/hooks/fleet/release-workflow-guard/index.mts → ../../../ = repo
    const candidate = path.resolve(scriptPath, '..', '..', '..', '..')
    /* c8 ignore start - candidate path (.github/workflows existence) depends on import.meta.url location at runtime; both arms are structurally unreachable from in-process tests */
    if (existsSync(path.join(candidate, '.github', 'workflows'))) {
      projectDir = candidate
    }
    /* c8 ignore stop */
  }
  if (!projectDir) {
    projectDir = process.cwd()
  }
  const repoMatch = GH_REPO_FLAG_RE.exec(command)
  if (repoMatch && path.basename(projectDir) !== repoMatch.groups!.repoName!) {
    // Cross-repo dispatch: only look in the sibling clone. Excluding
    // projectDir keeps a same-name workflow in the current checkout
    // from false-positiving the verification.
    return [path.join(path.dirname(projectDir), repoMatch.groups!.repoName!)]
  }
  // Same-repo (no --repo, or --repo names the current project): add
  // process.cwd() when it differs from projectDir AND any inline
  // `cd <path> &&` prefix in the command itself. Claude Code's Bash
  // tool runs PreToolUse hooks with cwd = the session's project dir,
  // not the cwd that the chained command will switch to — so the
  // inline-cd parsing is the only way for the hook to find the
  // workflow YAML when the user types `cd ../sibling && gh workflow
  // run ...` from a session pinned to a different project.
  const roots: string[] = [projectDir]
  const cwd = process.cwd()
  if (
    cwd !== projectDir &&
    existsSync(path.join(cwd, '.github', 'workflows'))
  ) {
    roots.push(cwd)
  }
  const inlineCd = INLINE_CD_RE.exec(command)
  if (inlineCd) {
    // `cd path && gh workflow run ...` — resolve path relative to
    // projectDir (most common: a sibling clone). Absolute paths are
    // honored as-is; `~` is left literal because the hook can't
    // expand the user's $HOME safely. The named-group pick handles
    // single-quoted / double-quoted / bare forms via three
    // alternation groups in INLINE_CD_RE.
    const cdPath =
      inlineCd.groups?.sq ?? inlineCd.groups?.dq ?? inlineCd.groups?.bare
    /* c8 ignore next - cdPath is always defined when INLINE_CD_RE matches; all three alternation groups guarantee at least one capture */
    if (cdPath) {
      const resolved = path.isAbsolute(cdPath)
        ? cdPath
        : path.resolve(projectDir, cdPath)
      if (
        !roots.includes(resolved) &&
        existsSync(path.join(resolved, '.github', 'workflows'))
      ) {
        roots.push(resolved)
      }
    }
  }
  return roots
}

export function isVerifiableDryRun(
  command: string,
  workflow: string | undefined,
): boolean {
  if (!workflow) {
    return false
  }
  if (!DRY_RUN_TRUE_RE.test(command)) {
    return false
  }
  if (DRY_RUN_FALSE_RE.test(command)) {
    return false
  }
  if (FORCE_PROD_INPUTS_RE.test(command)) {
    return false
  }
  return workflowDeclaresDryRunInput(workflow, resolveSearchRoots(command))
}

// Decide whether a live (non-dry-run) dispatch is safe because the
// target workflow only releases to GitHub — never to npm.
// Conditions:
//   1. Workflow YAML contains no `npm/pnpm/yarn publish` reference.
//   2. Workflow YAML contains a GH-release indicator
//      (`gh release create`, softprops/action-gh-release, etc.).
//   3. No force-prod input (`-f publish=true` etc.) is set on the
//      command — those re-enable destructive steps that even an
//      otherwise-GH workflow may guard behind a flag.
//
// Recovery from a bad GH release is `gh release delete <tag>
// --cleanup-tag` — single command, undoes both tag and release. That
// shape is acceptable risk; npm publish is not.
export function isGhReleaseOnly(
  command: string,
  workflow: string | undefined,
): boolean {
  if (!workflow) {
    return false
  }
  if (FORCE_PROD_INPUTS_RE.test(command)) {
    return false
  }
  return classifyWorkflow(workflow, resolveSearchRoots(command)) === 'gh'
}

// Pull the workflow target token out of a parsed `gh workflow
// run/dispatch` arg list. Skips the `workflow` + `run`/`dispatch`
// subcommand words and any value-taking flag + its value; the first
// remaining bare positional is the target (`publish.yml`, `publish`,
// or a numeric id).
function extractWorkflowTarget(args: readonly string[]): string | undefined {
  // Locate the run/dispatch subcommand index after the `workflow` word.
  const wfIdx = args.indexOf('workflow')
  /* c8 ignore start - defensive guard; caller (detectDispatch) always passes args that include 'workflow' */
  if (wfIdx === -1) {
    return undefined
  }
  /* c8 ignore stop */
  let i = wfIdx + 1
  // The subcommand may be `run` or `dispatch`; skip exactly one.
  if (args[i] === 'dispatch' || args[i] === 'run') {
    i += 1
  } else {
    return undefined
  }
  for (const { length } = args; i < length; i += 1) {
    const arg = args[i]!
    // `--flag=value` form consumes its own value.
    if (arg.startsWith('--') && arg.includes('=')) {
      continue
    }
    if (GH_WORKFLOW_VALUE_FLAGS.has(arg)) {
      // Skip the flag's value token too.
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      // A bare flag with no value (rare here) — skip just the flag.
      continue
    }
    return arg
  }
  return undefined
}

export function detectDispatch(command: string): DispatchResult {
  // Cheap substring gate before any tokenize. A dispatch is either a
  // `gh workflow run/dispatch` (carries `workflow`) or a
  // `gh api .../actions/workflows/<id>/dispatches` call (carries
  // `dispatches`). A command with neither token can't be a dispatch, so we
  // skip the parser entirely on the common Bash path.
  if (!command.includes('workflow') && !command.includes('dispatches')) {
    return { blocked: false }
  }
  // Parser-based: each real `gh` invocation is inspected on its own
  // args, so a quoted "gh workflow run" in a message body or a sibling
  // command's string can't false-trigger, and `$(…)` / chains are seen
  // through. No module-scoped /g-regex `lastIndex` state to manage.
  //
  // Obfuscation guard: when `gh` is produced by a command substitution
  // (`$(echo gh) workflow run …`), shell-quote strands `workflow` as
  // the command's binary. Treat that shape as a dispatch too — a
  // security guard should block-the-default on an obfuscated `gh`
  // rather than wave it through.
  const ghCommands = commandsFor(command, 'gh')
  const obfuscatedWorkflowCommands = parseCommands(command).filter(
    c =>
      c.binary === 'workflow' &&
      (c.args[0] === 'dispatch' || c.args[0] === 'run'),
  )
  for (const c of [...ghCommands, ...obfuscatedWorkflowCommands]) {
    // Normalize: gh commands carry `workflow` in args; the obfuscated
    // shape carries it as the binary with run/dispatch in args[0]. Build
    // a uniform arg list that always starts at `workflow`.
    const wfArgs = c.binary === 'workflow' ? ['workflow', ...c.args] : c.args
    if (wfArgs.includes('workflow')) {
      const workflow = extractWorkflowTarget(wfArgs)
      if (workflow) {
        if (isVerifiableDryRun(command, workflow)) {
          return {
            allowedReason:
              'verifiable dry-run (-f dry-run=true + workflow declares dry-run input)',
            blocked: false,
            shape: 'gh workflow run/dispatch',
            workflow,
          }
        }
        if (isGhReleaseOnly(command, workflow)) {
          return {
            allowedReason:
              'GitHub-release-only workflow (no npm publish; reversible via `gh release delete --cleanup-tag`)',
            blocked: false,
            shape: 'gh workflow run/dispatch',
            workflow,
          }
        }
        return {
          blocked: true,
          shape: 'gh workflow run/dispatch',
          workflow,
        }
      }
    }
    // `gh api .../actions/workflows/<id>/dispatches`. The dry-run
    // bypass intentionally doesn't apply — that path takes inputs as a
    // JSON body, harder to verify; route those through the user.
    if (c.args.includes('api')) {
      for (let i = 0, { length } = c.args; i < length; i += 1) {
        const m = GH_API_DISPATCH_PATH_RE.exec(c.args[i]!)
        if (m) {
          return {
            blocked: true,
            shape: 'gh api .../dispatches',
            workflow: m.groups!.workflowId,
          }
        }
      }
    }
  }

  return { blocked: false }
}

export const check = bashGuard((command, payload) => {
  const { allowedReason, blocked, shape, workflow } = detectDispatch(command)
  if (!blocked) {
    if (allowedReason) {
      // Transparently log the bypass so the user sees why the guard
      // let it through. Notify only — no block, hook behaves as if it
      // never fired.
      return notify(
        /* c8 ignore next - workflow is always defined when allowedReason is set; detectDispatch populates both fields together */
        `[release-workflow-guard] ALLOWED: ${shape} on ${workflow ?? '<unknown>'} — ${allowedReason}`,
      )
    }
    return undefined
  }

  // Per-trigger phrase bypass. The user types
  // `Allow workflow-dispatch bypass: <workflow>` verbatim — one
  // phrase authorizes exactly one dispatch of that workflow. A
  // second dispatch of the same workflow needs a fresh phrase.
  //
  // Implementation: count the matching phrases the user has typed
  // and subtract the number of prior dispatches against the same
  // workflow already in the transcript. If anything's left, this
  // dispatch consumes one slot and is allowed.
  /* c8 ignore next - workflow is always defined when detectDispatch returns blocked:true; defensive guard for future code paths */
  if (workflow) {
    const acceptedPhrases = buildAcceptedPhrases(workflow)
    const priorDispatches = countPriorDispatches(
      payload.transcript_path,
      workflow,
    )
    const remaining = bypassPhraseRemaining(
      payload.transcript_path,
      acceptedPhrases,
      priorDispatches,
      BYPASS_LOOKBACK_USER_TURNS,
    )
    if (remaining > 0) {
      return notify(
        `[release-workflow-guard] ALLOWED: ${shape} on ${workflow} — bypass phrase consumed (${remaining - 1} remaining for this workflow)`,
      )
    }
  }

  /* c8 ignore start - workflow is always defined when blocked:true; the else/null arms here are defensive fallbacks unreachable from detectDispatch */
  const phraseExample = workflow
    ? `${BYPASS_PHRASE_PREFIX} ${workflow.replace(/\.(?:yaml|yml)$/i, '')}`
    : `${BYPASS_PHRASE_PREFIX} <workflow>`
  /* c8 ignore stop */
  return block(
    [
      '[release-workflow-guard] BLOCKED: this command would dispatch a',
      /* c8 ignore start - workflow ?? fallback unreachable: detectDispatch always sets workflow when blocked:true */
      `  GitHub Actions workflow (${shape}, target: ${workflow ?? '<unknown>'}).`,
      /* c8 ignore stop */
      '',
      '  Workflow dispatches often have irreversible prod side effects:',
      '    - Publish workflows push npm versions (unpublishable after 24h).',
      '    - Build/Release workflows create GitHub releases pinned by SHA.',
      '    - Container workflows push immutable image tags.',
      '',
      '  Bypass options:',
      '    (a) Verifiable dry-run:',
      '        - Pass `-f dry-run=true` explicitly, AND',
      '        - The workflow YAML must declare a `dry-run:` input under',
      '          its workflow_dispatch.inputs block.',
      '        - No force-prod overrides may be set',
      '          (e.g. -f release=true / -f publish=true).',
      `    (b) Per-trigger phrase bypass: the user types`,
      `        \`${phraseExample}\``,
      '        verbatim in a recent message. ONE phrase authorizes ONE',
      '        dispatch of that exact workflow. A second dispatch (or a',
      '        different workflow) needs its own phrase.',
      '',
      '  Without a bypass, the user runs workflow_dispatch jobs',
      '  manually. Tell the user to run the command in their own',
      '  terminal (or via the GitHub Actions UI), then resume.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
