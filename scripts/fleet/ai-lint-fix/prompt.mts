/**
 * @file Prompt construction for the ai-lint-fix step: bucket findings to the
 *   AI-handled subset per file, render the machine-readable findings + per-rule
 *   guidance blocks, and assemble the headless per-file prompt. Structure
 *   follows Anthropic's prompt-engineering guidance for headless tool-use; the
 *   orchestrator owns spawning, this owns what the model is told.
 */

import path from 'node:path'
import process from 'node:process'

import { AI_HANDLED_RULES, RULE_GUIDANCE } from './rule-guidance.mts'

import type { OxlintFile, OxlintMessage } from './oxlint-json.mts'

export function bucketFindings(
  files: OxlintFile[],
): Map<string, OxlintMessage[]> {
  const byFile = new Map<string, OxlintMessage[]>()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    const handled = f.messages.filter(
      m => m.ruleId !== undefined && AI_HANDLED_RULES.has(m.ruleId),
    )
    if (handled.length === 0) {
      continue
    }
    byFile.set(f.filePath, handled)
  }
  return byFile
}

export function renderFindings(findings: OxlintMessage[]): string {
  return findings
    .map(
      f =>
        `<finding rule="${f.ruleId}" line="${f.line}" column="${f.column}">${f.message
          .replace(/[<>&]/g, ch =>
            ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;',
          )
          .replace(/\n/g, ' ')}</finding>`,
    )
    .map(line => `  ${line}`)
    .join('\n')
}

export function renderRuleGuidance(findings: OxlintMessage[]): string {
  const seen = new Set<string>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    if (f.ruleId) {
      seen.add(f.ruleId)
    }
  }
  const entries = [...seen]
    .toSorted()
    .map(id => {
      const guidance = RULE_GUIDANCE[id]
      if (!guidance) {
        return ''
      }
      return `  <rule id="${id}">${guidance}</rule>`
    })
    .filter(s => s.length > 0)
  if (entries.length === 0) {
    return ''
  }
  return `<rules>\n${entries.join('\n')}\n</rules>`
}

/**
 * Build the per-file prompt. Structure follows Anthropic's prompt- engineering
 * best practices for headless tool-use:
 *
 * - <role>: senior engineer doing a careful refactor — sets the bar above "quick
 *   autofix" so the model treats edge cases.
 * - <task>: one-sentence framing.
 * - <file>: the target path. Edits must stay scoped to it.
 * - <findings>: machine-readable list of violations.
 * - <rules>: per-rule canonical rewrite + good/bad examples (low freedom).
 * - <process>: numbered steps that force a Read → reason → Edit → self-verify
 *   loop. Self-verify is the highest-leverage step — it catches the
 *   import/callsite mismatch class that produced past breakage.
 * - <constraints>: hard rules — no Bash, no Write, single-file scope, no orphan
 *   imports.
 * - <reminders>: instructions repeated at the END for the long- context regime
 *   per Anthropic guidance.
 * - <output>: response format expectation, prefilled to suppress markdown /
 *   preamble.
 *
 * The prompt is intentionally short but the structure is explicit. Adding
 * boilerplate dilutes instructions; omitting the verify step is how this prompt
 * has historically produced orphan imports.
 */
export function buildPrompt(
  filePath: string,
  findings: OxlintMessage[],
): string {
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- relative path for prompt display; user invokes `pnpm run fix` from their cwd and expects paths relative to where they ran.
  const rel = path.relative(process.cwd(), filePath)
  const findingsBlock = renderFindings(findings)
  const rulesBlock = renderRuleGuidance(findings)
  return `<role>
You are a principal TypeScript engineer with a perfectionist mindset applying a careful, minimal-diff refactor in response to lint findings. You hold yourself to a higher standard than the rule strictly requires: you read the whole file before touching it, you trace every reference you're about to rename, and you re-read the file after editing to confirm the result is internally consistent.

Opt for doing things correctly over cutting corners. If the right fix touches multiple parts of the file, do all of them. If the right fix requires understanding how a function is called within this file, read those callsites before editing. Never apply a partial fix that satisfies the lint message but leaves the file in a broken state. "Works on the happy path" is not done. "Builds, type-checks, and survives my own self-verification" is done.

A fix that introduces a runtime crash (e.g. renaming an imported binding without updating call sites) is worse than leaving the finding alone — when in doubt, skip the finding and report why.
</role>

<task>Fix the lint findings in a single source file. Do not edit other files.</task>

<file>${rel}</file>

<findings>
${findingsBlock}
</findings>

${rulesBlock}

<process>
  <step n="1">Use the Read tool to view ${rel} in full. Do not edit before reading.</step>
  <step n="2">For each finding, identify the canonical rewrite from the matching &lt;rule&gt; entry above. If multiple rewrites are possible, choose the one with the smallest diff.</step>
  <step n="3">Apply the rewrites with the Edit tool. Each Edit must preserve unrelated code, comments, blank lines, and formatting exactly.</step>
  <step n="4">SELF-VERIFY: use the Read tool to view ${rel} again. Walk through every import you changed and confirm every reference to the old name in the same file is either (a) covered by the new import, or (b) also rewritten in the same Edit pass. A file that imports X but uses Y, or imports Y but uses X, is broken — fix it before you stop.</step>
  <step n="5">Reply with ONE short sentence summarizing what changed and (if applicable) which findings you skipped and why.</step>
</process>

<constraints>
  <constraint>Edit only ${rel}. Do not create new files. Do not run Bash commands.</constraint>
  <constraint>NEVER end an edit with an imported binding that's not used, or a used identifier that's not imported. Self-verify (step 4) is required, not optional.</constraint>
  <constraint>If a finding requires changes you cannot safely make (e.g. splitting a 1000-line file, implementing a placeholder, a rewrite that ripples into other files), skip it and state why. Do not delete the marker, do not produce a partial fix, do not invent a workaround.</constraint>
  <constraint>If you cannot determine the right rewrite for a finding, skip it. A skipped finding will be re-evaluated on the next lint run; a wrong fix breaks the build.</constraint>
  <constraint>Apply the minimum diff needed. No drive-by cleanups, no reformatting, no "while I'm here" changes.</constraint>
</constraints>

<reminders>
The single most important step is step 4 (self-verify). Past failures: import binding renamed (\`spawnSync\` → \`spawn\`) but every call site still says \`spawnSync\` — module load crashes with ReferenceError. Local const injected when an \`export const\` of the same name already exists — module load crashes with redeclaration error. Both are caught by step 4. Run step 4 every time, no exceptions.
</reminders>

<output>One short sentence. No markdown, no code blocks, no preamble. Format: "Fixed N findings: <summary>." or "Fixed N findings, skipped M: <summary>; <skip reasons>." If you applied no edits, lead with "Skipped all findings: <reason>".</output>`
}
