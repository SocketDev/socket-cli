#!/usr/bin/env node
// Claude Code PreToolUse hook — release-workflow-guard.
//
// BLOCKS every Bash command that would dispatch a GitHub Actions
// workflow. The user runs workflow_dispatch jobs manually after
// reviewing the release commit and waiting for CI to pass —
// auto-triggering is irrevocable in the short term:
//
//   - Publish workflows push npm versions (unpublishable after 24h).
//   - Build/Release workflows publish GitHub releases pinned by SHA.
//   - Container workflows push immutable image tags.
//
// Even nominally-CI workflow_dispatches often carry prod side
// effects — the dispatch itself is the trigger that runs the
// release pipeline, even when an input gates the destructive step.
// Default policy: block all dispatches and ask the user to run them
// themselves. Cost of an extra block: one re-prompt. Cost of a
// missed prod publish: irreversible.
//
// Exit code 2 with a clear stderr message stops the tool call. The
// model never gets to fire the command. The user re-runs it from
// their own terminal (or via the GitHub Actions UI) when ready.
//
// Blocked patterns:
//   - `gh workflow run <id>`
//   - `gh workflow dispatch <id>` (alias of `run`)
//   - `gh api ... actions/workflows/<id>/dispatches` POST/PUT
//
// Bypass — verifiable dry-run only:
//   - Pass `-f dry-run=true` (or =1/=yes) explicitly.
//   - The workflow YAML must declare a `dry-run:` input under its
//     `workflow_dispatch.inputs` block. The hook reads the workflow
//     file from disk: first $CLAUDE_PROJECT_DIR/.github/workflows/,
//     then (if `--repo owner/<name>` names a different repo) the
//     sibling clone at `<parent-of-project-dir>/<name>/.github/...`.
//     Cross-repo dispatches verify when the sibling clone exists;
//     otherwise the bypass denies (same posture as a missing file).
//   - No force-prod overrides may be set: `-f release=true`,
//     `-f publish=true`, `-f prod=true`, `-f production=true`.
//   - Bypass applies only to `gh workflow run|dispatch`. The
//     `gh api .../dispatches` shape takes inputs as a JSON body,
//     which is harder to verify safely; route those through the user.
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

type ToolInput = {
  tool_name?: string
  tool_input?: {
    command?: string
  }
}

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

// `--repo <owner>/<name>` parser. Captures the repo name (after the
// slash). Used to gate the dry-run bypass: a dispatch targeting a
// repo other than the current $CLAUDE_PROJECT_DIR can't be verified
// from disk, so we conservatively block it.
const GH_REPO_FLAG_RE = /\s--repo\s+\S*?\/([^\s/]+)/

// Walk the command and return a per-position boolean: true means the
// char at index i sits inside a single- or double-quoted string. We
// use this to skip matches that fall inside `git commit -m "..."`
// message bodies, heredocs, etc. — text that the shell will pass as
// a literal argument value, not execute. Without this, mentioning
// `gh workflow run` inside a commit message body trips the hook.
//
// Limitations: this is not a full POSIX shell parser. Heredocs
// (<<EOF ... EOF) read as code-mode here, but in practice commit
// messages via heredoc are quoted by `$(cat <<'EOF' ... EOF)` and
// the outer `$(...)`/`"..."` wrap puts the body in quoted-mode.
// `\$` and other escapes inside quotes are honored only in the
// limited sense of skipping the next char.
function buildQuoteMask(s: string): boolean[] {
  const mask = new Array<boolean>(s.length).fill(false)
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (!inSingle && !inDouble && c === "'") {
      inSingle = true
      mask[i] = true
      continue
    }
    if (inSingle && c === "'") {
      inSingle = false
      mask[i] = true
      continue
    }
    if (!inSingle && !inDouble && c === '"') {
      inDouble = true
      mask[i] = true
      continue
    }
    if (inDouble && c === '"') {
      inDouble = false
      mask[i] = true
      continue
    }
    if (inDouble && c === '\\' && i + 1 < s.length) {
      mask[i] = true
      mask[i + 1] = true
      i += 1
      continue
    }
    mask[i] = inSingle || inDouble
  }
  return mask
}

type DispatchResult = {
  blocked: boolean
  workflow?: string
  shape?: string
  // When `blocked` is false, populated with the reason the dispatch
  // was allowed through. Surfaced in the hook's "allowed" log line so
  // the user can see exactly why the guard let it pass.
  allowedReason?: string
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
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  const repoMatch = GH_REPO_FLAG_RE.exec(command)
  // No --repo, or --repo names the current project: search only the
  // current project. With --repo naming a different project: search
  // ONLY the sibling clone — falling back to projectDir would falsely
  // verify a same-named workflow that happens to live in the current
  // checkout but isn't the dispatch's actual target.
  let searchRoots: string[]
  if (!repoMatch || path.basename(projectDir) === repoMatch[1]!) {
    searchRoots = [projectDir]
  } else {
    const sibling = path.join(path.dirname(projectDir), repoMatch[1]!)
    searchRoots = [sibling]
  }
  return workflowDeclaresDryRunInput(workflow, searchRoots)
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
          blocked: false,
          workflow,
          shape: 'gh workflow run/dispatch',
          allowedReason:
            'verifiable dry-run (-f dry-run=true + workflow declares dry-run input)',
        }
      }
      return {
        blocked: true,
        workflow,
        shape: 'gh workflow run/dispatch',
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
        workflow: apiMatch[1],
        shape: 'gh api .../dispatches',
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

  const { blocked, workflow, shape, allowedReason } = detectDispatch(command)
  if (!blocked) {
    if (allowedReason) {
      // Transparently log the bypass so the user sees why the guard
      // let it through. Stderr only — no exit-code change, hook
      // behaves as if it never fired.
      process.stderr.write(
        `[release-workflow-guard] ALLOWED: ${shape} on ${workflow ?? '<unknown>'} — ${allowedReason}\n`,
      )
    }
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
    '  Allowed bypass — verifiable dry-run:',
    '    - Pass `-f dry-run=true` explicitly, AND',
    '    - The workflow YAML must declare a `dry-run:` input under',
    '      its workflow_dispatch.inputs block.',
    '    - No force-prod overrides may be set',
    '      (e.g. -f release=true / -f publish=true).',
    '',
    '  Without that bypass, the user runs workflow_dispatch jobs',
    '  manually. Tell the user to run the command in their own',
    '  terminal (or via the GitHub Actions UI), then resume.',
  ]
  process.stderr.write(lines.join('\n') + '\n')
  process.exitCode = 2
}

main()
