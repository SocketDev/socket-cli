#!/usr/bin/env node
// Claude Code PreToolUse hook — reserved-script-dir-guard.
//
// Blocks Edit/Write that create a file under a `scripts/<reserved>/` dir
// whose name collides with a build / output / tooling concept. `scripts/`
// holds two canonical tiers — `scripts/fleet/` (wheelhouse-canonical) and
// `scripts/repo/` (repo-owned) — plus feature dirs named for what they do.
// A dir called `build`, `dist`, `node_modules`, `coverage`, or `cache`
// overloads a reserved meaning (build is a lifecycle script + `dist/` is the
// output; `node_modules`/`cache` are install/tool dirs) and reads ambiguously.
//
// Incident: 2026-06-03 socket-lib had `scripts/build/` whose `cli.mts` was the
// rolldown build runner — `build` collides with the `build` package.json
// script + the `dist/` output + `scripts/build-externals/`. Renamed to
// `scripts/bundle/`. This guard stops the pattern recurring at edit time.
//
// Allowed: scripts/fleet/**, scripts/repo/**, scripts/_*/** (internals), and
// any feature dir NOT in the reserved set (e.g. scripts/bundle/, scripts/post-
// build/ — note `post-build` is not reserved, only the bare `build`).
//
// Blocked: scripts/build/**, scripts/dist/**, scripts/node_modules/**,
// scripts/coverage/**, scripts/cache/**.
//
// Bypass: `Allow reserved-script-dir bypass` in a recent user turn.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// Dir names under scripts/ that collide with build/output/tooling concepts.
// `fleet`/`repo` are the canonical tiers and are deliberately NOT here.
const RESERVED_DIRS: readonly string[] = [
  'build',
  'cache',
  'coverage',
  'dist',
  'node_modules',
]

// Match `scripts/<entry>/` where the path continues past the dir (i.e. the
// entry is a directory containing the edited file, not a file itself). Path is
// normalized to `/` first so the regex stays single-separator.
const RESERVED_RE = new RegExp(
  String.raw`(?:^|/)scripts/(?<entry>${RESERVED_DIRS.join('|')})/`,
)

export function reservedScriptDir(filePath: string): string | undefined {
  const m = RESERVED_RE.exec(normalizePath(filePath))
  return m?.groups?.['entry']
}

export const check = editGuard((filePath, _content, _payload) => {
  const entry = reservedScriptDir(filePath)
  if (!entry) {
    return undefined
  }
  const suggestion = entry === 'build' ? 'bundle' : '<what-it-does>'
  return block(
    [
      '[reserved-script-dir-guard] Blocked: reserved `scripts/` dir name.',
      '',
      `  Path: scripts/${entry}/…`,
      '',
      `  \`scripts/${entry}/\` overloads a build/output/tooling concept.`,
      '  scripts/ has two canonical tiers — `scripts/fleet/` (wheelhouse) and',
      '  `scripts/repo/` (repo-owned) — plus feature dirs named for what they',
      '  do. Pick a descriptive name instead:',
      '',
      `    scripts/${suggestion}/  not  scripts/${entry}/`,
      '',
      `  Reserved (blocked): ${RESERVED_DIRS.join(', ')}.`,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['reserved-script-dir'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
