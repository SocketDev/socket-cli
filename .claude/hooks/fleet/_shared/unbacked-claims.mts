// Shared detection for unbacked success claims — consumed by BOTH
// `stop-claim-verify-nudge` (Stop-time nudge) and
// `unbacked-claim-commit-guard` (PreToolUse block on commit/push). One matcher,
// two enforcement points, no drift.
//
// The fleet rule (CLAUDE.md "Judgment & self-evaluation" → "Verify before you
// claim"): never assert "tests pass" / "builds" / "typechecks" / "lint passes"
// / "render verified" without a tool call THIS SESSION that ran or read it.
// A claim fires only when NONE of its backing-command patterns appear in any
// Bash command run this session.

import { commandsFor } from './shell-command.mts'
import {
  extractToolUseBlocks,
  readLines,
  resolveRoleAndContent,
  stripCodeFences,
} from './transcript.mts'

export interface InvocationSignal {
  // If set, the invocation backs the claim only when one of these appears in
  // its parsed args (a subcommand like `test`, or a flag like `--test`);
  // omitted means the binary alone backs it.
  readonly args?: readonly string[]
  // The command binary (e.g. `cargo`, `pnpm`, `node`).
  readonly binary: string
}

export interface ClaimRule {
  // Bare-token substrings that, in ANY Bash command this session, back the
  // claim (tool names like `vitest`; NOT command+arg parsing — that's `commands`).
  readonly backedBy: readonly RegExp[]
  // Matches the self-claim in the assistant's prose.
  readonly claim: RegExp
  // Parsed command invocations that back the claim — matched via the shell AST
  // parser (sees through `&&`/`|`/`;` and quoting), never a command-parsing regex.
  readonly commands?: readonly InvocationSignal[]
  // One-line hint.
  readonly hint: string
  // Category label.
  readonly label: string
}

export const CLAIM_RULES: readonly ClaimRule[] = [
  {
    label: 'tests pass',
    claim:
      // Optional "all", then "test(s)" within 30 chars of pass/green/succeed variants.
      /\b(?:all )?tests?\b[^.!?\n]{0,30}\b(?:pass(?:ed|ing)?|green|succeed(?:ed)?)\b/i,
    backedBy: [/\bvitest\b/],
    commands: [
      { args: ['test'], binary: 'pnpm' },
      { args: ['--test'], binary: 'node' },
      { args: ['test', 'nextest'], binary: 'cargo' },
    ],
    hint: 'run the test command (`pnpm test` / `vitest run <file>` / `cargo test`) or qualify the claim',
  },
  {
    label: 'build succeeds',
    claim:
      // "build/builds/built" within 30 chars of succeed/clean/pass/work variants.
      /\bbuild(?:s|ed)?\b[^.!?\n]{0,30}\b(?:succeed(?:ed|s)?|clean|pass(?:ed|es)?|work(?:s|ed)?)\b/i,
    backedBy: [/\brolldown\b/],
    commands: [
      { args: ['build'], binary: 'pnpm' },
      { args: ['build', 'check'], binary: 'cargo' },
    ],
    hint: 'run the build (`pnpm build` / `cargo build`) or qualify the claim',
  },
  {
    label: 'typechecks',
    claim:
      // "typecheck(s)" within 20 chars of pass/clean, or the phrase "no type errors".
      /\b(?:type[- ]?checks?\b[^.!?\n]{0,20}\b(?:pass(?:es|ed)?|clean)|no type errors)\b/i,
    backedBy: [/\btsgo\b/, /\btsc\b/],
    commands: [
      { args: ['check'], binary: 'pnpm' },
      { args: ['check'], binary: 'cargo' },
    ],
    hint: 'run tsgo / `pnpm run check` / `cargo check` or qualify the claim',
  },
  {
    label: 'lint passes',
    // "lint/linting" within 25 chars of pass/clean/green variants.
    claim: /\blint(?:ing)?\b[^.!?\n]{0,25}\b(?:pass(?:es|ed)?|clean|green)\b/i,
    backedBy: [/\boxlint\b/],
    commands: [
      { args: ['lint', 'check'], binary: 'pnpm' },
      { args: ['clippy'], binary: 'cargo' },
    ],
    hint: 'run `pnpm run lint` / `cargo clippy` or qualify the claim',
  },
  {
    label: 'render verified',
    // A self-claim that the UI / popup / page was visually checked — "verified
    // the popup", "the UI renders correctly", "looks good on screen", "rendered
    // to PNG", "visually verified". Backed ONLY by an actual render this session.
    claim:
      // "visually verified" OR "verified <element>" OR "<element> looks good/renders correctly/verified" — three claim shapes.
      /\b(?:visually verif(?:y|ied)|verif(?:y|ied)\b[^.!?\n]{0,30}\b(?:popup|render|ui\b|screen|pixels?)|(?:popup|ui|render(?:ed|s)?|page|screen)\b[^.!?\n]{0,30}\b(?:looks? (?:good|correct|right)|renders? (?:correctly|fine)|verified))\b/i,
    backedBy: [
      /\bscreenshot\.mts\b/,
      /\brendering-chromium-to-png\b/,
      /\bplaywright\b/,
      /\bchromium\b/,
    ],
    hint: 'render the page to a PNG (rendering-chromium-to-png / screenshot.mts) and Read the pixels this session, or qualify the claim — bundle/build success is not visual verification',
  },
]

export interface UnbackedClaim {
  readonly label: string
  readonly hint: string
}

// Every Bash command string the assistant ran across the whole session.
export function sessionBashCommands(
  transcriptPath: string | undefined,
): string[] {
  const lines = readLines(transcriptPath)
  const commands: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    const r = resolveRoleAndContent(evt)
    if (!r || r.role !== 'assistant') {
      continue
    }
    const tools = extractToolUseBlocks(r.content)
    for (let j = 0, { length: tl } = tools; j < tl; j += 1) {
      const t = tools[j]!
      if (t.name !== 'Bash') {
        continue
      }
      const cmd = t.input['command']
      if (typeof cmd === 'string') {
        commands.push(cmd)
      }
    }
  }
  return commands
}

// Claims in `assistantText` that no Bash command this session backs.
export function findUnbackedClaims(
  assistantText: string,
  bashCommands: readonly string[],
): UnbackedClaim[] {
  const text = stripCodeFences(assistantText)
  const joined = bashCommands.join('\n')
  const out: UnbackedClaim[] = []
  for (let i = 0, { length } = CLAIM_RULES; i < length; i += 1) {
    const rule = CLAIM_RULES[i]!
    if (!rule.claim.test(text)) {
      continue
    }
    const backed =
      rule.backedBy.some(re => re.test(joined)) ||
      !!rule.commands?.some(sig =>
        bashCommands.some(cmd =>
          commandsFor(cmd, sig.binary).some(
            c => !sig.args || sig.args.some(a => c.args.includes(a)),
          ),
        ),
      )
    if (!backed) {
      out.push({ label: rule.label, hint: rule.hint })
    }
  }
  return out
}
