import path from 'node:path'

// Pointer body for the frontmatter hosts and the Windows symlink fallback. Tiny
// on purpose — the rules live in CLAUDE.md and are never copied.
export const POINTER_BODY =
  'The authoritative engineering rules for this repository are in ' +
  '`./CLAUDE.md` (`./AGENTS.md` points at the same file). Read and follow them.\n'

// Cursor `.mdc` wants frontmatter for an always-on rule; `@CLAUDE.md` pulls the
// file in where the host resolves references.
const CURSOR_MDC =
  '---\n' +
  'description: Socket fleet engineering rules (canonical source is ./CLAUDE.md)\n' +
  'globs:\n' +
  'alwaysApply: true\n' +
  '---\n\n' +
  POINTER_BODY +
  '\n@CLAUDE.md\n'

// Kiro steering wants `inclusion: always`.
const KIRO_MD =
  '---\n' +
  'title: Socket fleet engineering rules\n' +
  'inclusion: always\n' +
  '---\n\n' +
  POINTER_BODY

// A `symlink` adapter is a relative symlink to CLAUDE.md (pointer-file fallback
// on Windows). A `file` adapter is a generated file with `content` (frontmatter
// hosts).
export type Adapter =
  | { dest: string; kind: 'symlink' }
  | { content: string; dest: string; kind: 'file' }
  | { dest: string; kind: 'copy'; src: string }

// Source files this generator copies VERBATIM, the same way
// scripts/repo/gen/bootstrap.mts copies prepare.mts and fetch-session.mts
// beside the bundle it builds. A copied adapter is real source - linted,
// type-checked and readable in place - rather than a string literal that
// escapes badly and no tool can see into.
const ADAPTER_SRC_DIR = import.meta.dirname

// The OpenCode guard bridge. Without it every guard under
// .claude/hooks/fleet/ is inert in an OpenCode session.
const OPENCODE_GUARDS_SRC = path.join(ADAPTER_SRC_DIR, 'fleet-guards.mts')

export const ADAPTERS: readonly Adapter[] = [
  { dest: '.clinerules/socket.md', kind: 'symlink' },
  { content: CURSOR_MDC, dest: '.cursor/rules/socket.mdc', kind: 'file' },
  { dest: '.github/copilot-instructions.md', kind: 'symlink' },
  ...['server', 'tool'].map(name => ({
    __proto__: null,
    dest: `.opencode/_shared/opencode/${name}.mts`,
    kind: 'copy' as const,
    src: path.join(ADAPTER_SRC_DIR, '../_shared/opencode', `${name}.mts`),
  })),
  { content: KIRO_MD, dest: '.kiro/steering/socket.md', kind: 'file' },
  // The destination is `.ts`, NOT `.mts`, and this is the one place the fleet's
  // `.mts` convention cannot hold. MEASURED with two identical dependency-free
  // plugins in one `.opencode/plugins/`, differing only by extension:
  //
  //     bare.ts   -> active
  //     bare.mts  -> absent from `opencode plugin list` entirely
  //
  // `.mts` is never attempted rather than rejected, so the failure is silent:
  // a session with zero guard coverage and a file that looks entirely correct.
  {
    dest: '.opencode/plugins/fleet-guards.ts',
    kind: 'copy',
    src: OPENCODE_GUARDS_SRC,
  },
  { dest: '.windsurf/rules/socket.md', kind: 'symlink' },
  { dest: 'AGENTS.md', kind: 'symlink' },
]
