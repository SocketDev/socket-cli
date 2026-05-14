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

import { buildQuoteMask } from '../_shared/bash-quote-mask.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?:
    | {
        command?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

// Bypass phrase: `Allow workflow-dispatch bypass`. Authorizes one
// dispatch when the user types this verbatim in a recent turn.
// Scoped to the active conversation — phrase is matched against the
// last `BYPASS_LOOKBACK_USER_TURNS` user turns from the transcript.
//
// Use cases that need the bypass (the dry-run path doesn't cover):
//   - Workflows that don't accept a `dry-run` input by design
//     (e.g. node-smol's main build, which has 30-minute side effects
//     but no inverse).
//   - One-off recovery dispatches after a stuck job.
//   - Re-dispatches after a transient infra failure (cache miss,
//     runner timeout) where the user has already verified the
//     previous run's intent.
const BYPASS_PHRASE = 'Allow workflow-dispatch bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// `gh workflow run <id-or-file>` / `gh workflow dispatch <id-or-file>`.
// The captured workflow argument is reported back so the user can
// see what was blocked.
const GH_WORKFLOW_DISPATCH_RE =
  /\bgh\s+workflow\s+(?:run|dispatch)\b(?:\s+(?:--repo|--ref|-f|--field)\s+\S+)*\s+(['"]?)([^\s'"]+)\1/g

// `gh api .../actions/workflows/<id>/dispatches` (POST/PUT).
// The path component implies dispatch — no need to also match -X.
const GH_API_WORKFLOW_DISPATCH_RE =
  /\bgh\s+api\b[^|]*?\/actions\/workflows\/([^/\s]+)\/dispatches\b/g

// Dry-run input detection. The fleet standardized on `dry-run`
// (kebab-case) — see socket-registry's shared actions and every
// `*.yml` workflow that takes a dispatch input. Match values
// "true"/"1"/"yes" as truthy and "false"/"0"/"no" as falsy. Quote-
// mask handling lives in detectDispatch; these regexes scan the
// same masked range as the dispatch detector.
const DRY_RUN_TRUE_RE = /-f\s+dry-run\s*=\s*['"]?(?:true|1|yes)['"]?/i
const DRY_RUN_FALSE_RE = /-f\s+dry-run\s*=\s*['"]?(?:false|0|no)['"]?/i

// Inputs that flip a workflow back into "do the prod thing." Even
// with dry-run=true, if any of these are explicitly set the dispatch
// is no longer benign — block. Order matters: this runs after
// dry-run detection, so an explicit publish=true overrides.
const FORCE_PROD_INPUTS_RE =
  /-f\s+(?:release|publish|prod|production)\s*=\s*['"]?(?:true|1|yes)['"]?/i

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
const GH_REPO_FLAG_RE = /\s--repo\s+\S*?\/([^\s/]+)/

// Inline `cd <path> && …` parser. Captures the destination path so
// the search-roots resolver can include it. Claude Code's Bash tool
// invokes PreToolUse hooks with cwd = the session's project dir
// (not the cwd the chained command will switch to), so without this
// parse the hook can't locate a workflow YAML that lives in the
// sibling clone the user is targeting via `cd`. The path may be
// quoted ("..." or '...'); strip the quotes for the resolver.
const INLINE_CD_RE = /(?:^|[;&])\s*cd\s+(?:'([^']+)'|"([^"]+)"|(\S+))\s*&&/
// (Use a single capture in the consumer by checking groups 1..3 — the
// regex syntax requires three alternation groups; the resolver picks
// the first non-undefined.)

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
function classifyWorkflow(
  workflow: string,
  searchRoots: readonly string[],
): 'npm' | 'gh' | 'unknown' {
  if (!/\.(?:yml|yaml)$/i.test(workflow)) {
    return 'unknown'
  }
  const filename = path.basename(workflow)
  for (const root of searchRoots) {
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

function workflowDeclaresDryRunInput(
  workflow: string,
  searchRoots: readonly string[],
): boolean {
  // Workflow arg can be "id.yml", "name.yaml", a numeric ID, or a path.
  // Numeric IDs and paths-without-extension can't be resolved without
  // hitting GitHub's API — for those, conservatively return false.
  if (!/\.(?:yml|yaml)$/i.test(workflow)) {
    return false
  }
  // Strip any leading directory prefix the user passed (e.g. they
  // typed the path explicitly). The bare filename is what
  // .github/workflows/ holds.
  const filename = path.basename(workflow)
  for (const root of searchRoots) {
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
function resolveSearchRoots(command: string): string[] {
  // Resolution order: $CLAUDE_PROJECT_DIR (Claude Code sets this when
  // it remembers to) → derive from this hook script's path (the hook
  // lives at <project>/.claude/hooks/release-workflow-guard/index.mts,
  // so go three levels up from __dirname) → $PWD as last resort.
  // The script-path derivation is the most robust because it doesn't
  // depend on the runner exporting env vars correctly.
  let projectDir = process.env['CLAUDE_PROJECT_DIR']
  if (!projectDir) {
    // process.argv[1] is the absolute path of this hook script when
    // invoked via `node <path>`. Walk up to the repo root.
    const scriptPath = process.argv[1]
    if (scriptPath) {
      // .claude/hooks/release-workflow-guard/index.mts → ../../../ = repo
      const candidate = path.resolve(scriptPath, '..', '..', '..', '..')
      if (existsSync(path.join(candidate, '.github', 'workflows'))) {
        projectDir = candidate
      }
    }
  }
  if (!projectDir) {
    projectDir = process.cwd()
  }
  const repoMatch = GH_REPO_FLAG_RE.exec(command)
  if (repoMatch && path.basename(projectDir) !== repoMatch[1]!) {
    // Cross-repo dispatch: only look in the sibling clone. Excluding
    // projectDir keeps a same-name workflow in the current checkout
    // from false-positiving the verification.
    return [path.join(path.dirname(projectDir), repoMatch[1]!)]
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
  if (cwd !== projectDir && existsSync(path.join(cwd, '.github', 'workflows'))) {
    roots.push(cwd)
  }
  const inlineCd = INLINE_CD_RE.exec(command)
  if (inlineCd) {
    // `cd path && gh workflow run ...` — resolve path relative to
    // projectDir (most common: a sibling clone). Absolute paths are
    // honored as-is; `~` is left literal because the hook can't
    // expand the user's $HOME safely. The capture-group pick handles
    // single-quoted / double-quoted / bare forms via three
    // alternation groups in INLINE_CD_RE.
    const cdPath = inlineCd[1] ?? inlineCd[2] ?? inlineCd[3]
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

function isVerifiableDryRun(
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
function isGhReleaseOnly(
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

function detectDispatch(command: string): DispatchResult {
  // We can't `replace(/\s+/g, ' ')` first because that would offset
  // the quote mask from the original string. Match against the raw
  // command and use the mask to filter false-positives.
  const mask = buildQuoteMask(command)

  // The /g-flag regex is a module-scoped singleton; `.exec()` advances
  // `lastIndex` and only resets when it returns null at end-of-input.
  // If our previous call broke out of the loop early (because we found
  // a quote-masked match), `lastIndex` is left mid-string and the next
  // `detectDispatch` call would resume from there instead of scanning
  // the whole command. Reset before each scan to make the regex
  // stateless from the caller's perspective.
  GH_WORKFLOW_DISPATCH_RE.lastIndex = 0
  let cliMatch: RegExpExecArray | null
  while ((cliMatch = GH_WORKFLOW_DISPATCH_RE.exec(command))) {
    if (!mask[cliMatch.index]) {
      const workflow = cliMatch[2]
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

  // Same /g-flag reset rationale as above — keep the regex stateless
  // across calls. The dry-run bypass intentionally doesn't apply to
  // `gh api .../dispatches` — that path takes inputs as a JSON body,
  // which is harder to verify safely; route those through the user.
  GH_API_WORKFLOW_DISPATCH_RE.lastIndex = 0
  let apiMatch: RegExpExecArray | null
  while ((apiMatch = GH_API_WORKFLOW_DISPATCH_RE.exec(command))) {
    if (!mask[apiMatch.index]) {
      return {
        blocked: true,
        shape: 'gh api .../dispatches',
        workflow: apiMatch[1],
      }
    }
  }

  return { blocked: false }
}

function main(): void {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    return
  }

  let input: ToolInput
  try {
    input = JSON.parse(raw)
  } catch {
    return
  }

  if (input.tool_name !== 'Bash') {
    return
  }
  const command = input.tool_input?.command
  if (!command || typeof command !== 'string') {
    return
  }

  const { allowedReason, blocked, shape, workflow } = detectDispatch(command)
  if (!blocked) {
    if (allowedReason) {
      // Transparently log the bypass so the user sees why the guard
      // let it through. Stderr only — no exit-code change, hook
      // behaves as if it never fired.
      process.stderr.write( // socket-hook: allow console
        `[release-workflow-guard] ALLOWED: ${shape} on ${workflow ?? '<unknown>'} — ${allowedReason}\n`,
      )
    }
    return
  }

  // Phrase-based bypass. The user types `Allow workflow-dispatch
  // bypass` verbatim in a recent turn → the hook authorizes one
  // dispatch. Transparently logged so the audit trail names the
  // workflow that was allowed.
  if (bypassPhrasePresent(
    input.transcript_path,
    BYPASS_PHRASE,
    BYPASS_LOOKBACK_USER_TURNS,
  )) {
    process.stderr.write( // socket-hook: allow console
      `[release-workflow-guard] ALLOWED: ${shape} on ${workflow ?? '<unknown>'} — bypass phrase "${BYPASS_PHRASE}" found in transcript\n`,
    )
    return
  }

  const lines = [
    '[release-workflow-guard] BLOCKED: this command would dispatch a',
    `  GitHub Actions workflow (${shape}, target: ${workflow ?? '<unknown>'}).`,
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
    `    (b) Explicit phrase bypass: the user types \`${BYPASS_PHRASE}\``,
    '        verbatim in a recent message. Use this for workflows that',
    '        don\'t accept a dry-run input (e.g. node-smol build) or',
    '        for one-off recovery dispatches.',
    '',
    '  Without a bypass, the user runs workflow_dispatch jobs',
    '  manually. Tell the user to run the command in their own',
    '  terminal (or via the GitHub Actions UI), then resume.',
  ]
  process.stderr.write(lines.join('\n') + '\n') // socket-hook: allow console
  process.exitCode = 2
}

main()
