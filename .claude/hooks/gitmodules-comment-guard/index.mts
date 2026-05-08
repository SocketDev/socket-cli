#!/usr/bin/env node
// Claude Code PreToolUse hook — gitmodules-comment-guard.
//
// Blocks Edit/Write tool calls that introduce a `[submodule "..."]`
// section into `.gitmodules` without the canonical `# <name>-<version>`
// comment immediately above it. Without that comment, the harness
// can't surface upstream version drift in the `lockstep` reports — the
// fleet relies on this annotation to know what version each pinned
// submodule represents.
//
// What's enforced:
//   - Every `[submodule "PATH"]` line must be preceded (immediately,
//     no blank line) by `# <slug>-<version>` where <slug> matches
//     `[a-z0-9]([a-z0-9-]*[a-z0-9])?` and <version> is whatever the
//     upstream uses (`v25.9.0`, `0.1.0`, `1.7.19`, `liburing-2.14`,
//     `epochs/three_hourly/2026-02-24_21H`, etc.). The version is
//     the part after the FIRST hyphen — we don't try to parse it
//     beyond "non-empty".
//   - `ignore = dirty` is conventional but not enforced here (it's a
//     parallel-Claude-sessions concern; submodule add without it is
//     not a build break).
//
// Scope:
//   - Fires on Edit and Write tool calls.
//   - Only inspects `.gitmodules` at the repo root.
//   - Lines marked `# socket-hook: allow gitmodules-no-comment` are
//     exempt for one-off legitimate cases.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import process from 'node:process'

const ALLOW_MARKER = '# socket-hook: allow gitmodules-no-comment'

// Match `[submodule "PATH"]` with PATH captured. Tolerant of
// whitespace and quoting variations.
const SUBMODULE_RE = /^\s*\[submodule\s+"([^"]+)"\s*\]\s*$/

// Match `# <slug>-<version>` where the version is whatever follows
// the first hyphen. We only require: starts with `# `, contains a
// hyphen, has non-empty version part.
const COMMENT_RE = /^#\s+[a-z0-9]+([a-z0-9-]*[a-z0-9])?-[^\s]/

interface Hook {
  // tool_name and tool_input shape — keeping it loose because the
  // PreToolUse payload schema isn't versioned beyond JSON-with-body.
  tool_name?: string
  tool_input?: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

// Read newline-separated lines for analysis.
function findOrphanSubmoduleSections(text: string): string[] {
  const lines = text.split('\n')
  const orphans: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const match = SUBMODULE_RE.exec(line)
    if (!match) continue
    // Allow marker on the [submodule] line or the line above is
    // a one-off escape hatch.
    if (line.includes(ALLOW_MARKER)) continue
    if (i > 0 && lines[i - 1]?.includes(ALLOW_MARKER)) continue
    // The previous line must be a comment matching `# <slug>-<ver>`.
    const prev = i > 0 ? lines[i - 1] : ''
    if (!prev || !COMMENT_RE.test(prev)) {
      orphans.push(match[1] ?? line)
    }
  }
  return orphans
}

function main() {
  let stdin = ''
  process.stdin.on('data', chunk => {
    stdin += chunk
  })
  process.stdin.on('end', () => {
    let payload: Hook
    try {
      payload = JSON.parse(stdin) as Hook
    } catch {
      // Bad payload — fail open.
      process.exit(0)
    }
    const tool = payload.tool_name
    if (tool !== 'Edit' && tool !== 'Write') {
      process.exit(0)
    }
    const filePath = payload.tool_input?.file_path
    if (!filePath || !filePath.endsWith('/.gitmodules')) {
      process.exit(0)
    }
    // Edit gives us new_string (the replacement); Write gives us
    // content (the full new file). Either way, we scan the proposed
    // text for the orphan condition. For Edit calls the new_string
    // may be a fragment that doesn't contain a [submodule] header —
    // that's fine, the check passes.
    const proposed =
      payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
    const orphans = findOrphanSubmoduleSections(proposed)
    if (orphans.length === 0) {
      process.exit(0)
    }
    // Block the tool call. Exit code 2 makes Claude Code refuse and
    // surface the stderr to the model so it can retry.
    process.stderr.write(
      `[gitmodules-comment-guard] refusing edit: ${orphans.length} ` +
        `submodule section(s) lack the canonical ` +
        `# <slug>-<version> comment immediately above:\n` +
        orphans.map(o => `    [submodule "${o}"]`).join('\n') +
        '\n\nFix: prepend a comment line on the line BEFORE each\n' +
        '[submodule "..."] section. Example:\n' +
        '\n  # semver-7.7.4\n  [submodule "packages/.../upstream/semver"]\n' +
        '\nThe slug should be a short name (no path); the version is\n' +
        'whatever the upstream tags (v25.9.0, 1.7.19, liburing-2.14, etc.).\n' +
        '\nOne-off override: append `# socket-hook: allow gitmodules-no-comment`\n' +
        'to the [submodule] line.\n',
    )
    process.exit(2)
  })
  // If stdin is closed before any data, treat as empty payload.
  if (process.stdin.readable === false) {
    process.exit(0)
  }
}

main()
