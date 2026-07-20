#!/usr/bin/env node
// Claude Code PreToolUse hook — release-tag-tied-guard.
//
// A GitHub release is always tied to a git tag. This hook ALLOWS
// `gh release create <ref> …` only when `<ref>` is an EXISTING pushed (or
// local) tag — the legitimate backfill case (`gh release create v0.0.18
// --verify-tag …`). It BLOCKS when the tag does not exist (gh would create
// it on the fly = an arbitrary, un-reviewed tag) or when `--target` is
// present (gh would create the tag from that branch/sha).
//
// Why gate it instead of denying outright: the fleet's settings.json moves
// `Bash(gh release create:*)` from `deny` to `allow` so tag-backfills run
// without a prompt; this hook is the safety rail that keeps "allow" from
// meaning "create any release at any ref".
//
// Tag existence is checked two ways (either is sufficient):
//   - local:  `git rev-parse --verify --quiet refs/tags/<ref>`
//   - remote: `git ls-remote --tags origin <ref>` returns a ref line
//
// Bypass: `Allow arbitrary-release bypass` typed verbatim in a recent turn.
//
// Fails open on parse / payload / git errors (exit 0) — a guard bug must not
// wedge every release command.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// `gh release create` flags that consume the FOLLOWING token as their value.
// Skipping their values keeps the positional <tag> scan from mistaking a
// flag value (e.g. `--title v1.2.3`) for the release ref.
const VALUE_FLAGS = new Set([
  '--discussion-category',
  '--notes',
  '--notes-file',
  '--notes-start-tag',
  '--repo',
  '--target',
  '--title',
  '-F',
  '-n',
  '-R',
  '-t',
])

// Pre-flight gate for the dispatcher: this guard can only ever block a
// `gh release create …` invocation, whose detection requires the literal
// `release` token adjacent to `create`. A command without `release` can never
// reach a block, so the dispatcher skips importing this guard for it.
export const triggers: readonly string[] = ['release']

export interface ReleaseCreateDetection {
  readonly detected: boolean
  // The release ref (first positional after `create`); '' when none was found.
  readonly ref: string
  // True when `--target <commitish>` is present (gh would create the tag).
  readonly hasTarget: boolean
}

const NOT_DETECTED: ReleaseCreateDetection = {
  detected: false,
  hasTarget: false,
  ref: '',
}

// Find a real `gh release create …` invocation and pull out its ref + whether
// `--target` is set. Parser-based (commandsFor), so a quoted "gh release
// create" inside another command's string isn't a false trigger.
export function detectReleaseCreate(command: string): ReleaseCreateDetection {
  for (const { args } of commandsFor(command, 'gh')) {
    const createIdx = args.indexOf('create')
    if (
      createIdx < 1 ||
      args[createIdx - 1] !== 'release' ||
      args.indexOf('release') !== createIdx - 1
    ) {
      continue
    }
    let ref = ''
    let hasTarget = false
    for (let i = createIdx + 1, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg === '--target' || arg.startsWith('--target=')) {
        hasTarget = true
      }
      if (arg.startsWith('-')) {
        // A value-taking flag in `--flag value` form swallows the next token.
        if (VALUE_FLAGS.has(arg) && !arg.includes('=')) {
          i += 1
        }
        continue
      }
      if (!ref) {
        ref = arg
      }
    }
    return { detected: true, hasTarget, ref }
  }
  return NOT_DETECTED
}

// True when `<ref>` resolves to an existing tag — local first, then remote.
export function tagExists(ref: string, cwd: string): boolean {
  if (!ref) {
    return false
  }
  const local = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${ref}`],
    { cwd, stdio: 'pipe' },
  )
  if (!local.error && local.status === 0) {
    return true
  }
  const remote = spawnSync('git', ['ls-remote', '--tags', 'origin', ref], {
    cwd,
    stdio: 'pipe',
  })
  /* c8 ignore next - remote exits 0 with empty stdout only in live-network git; in-process tests always see exit 128 (no auth) */
  return !remote.error && remote.status === 0 && !!String(remote.stdout).trim()
}

export function formatBlock(d: ReleaseCreateDetection): string {
  const reason = d.hasTarget
    ? `\`--target\` is set, so \`gh release create\` would CREATE the tag${d.ref ? ` \`${d.ref}\`` : ''} from that commitish.`
    : d.ref
      ? `tag \`${d.ref}\` does not exist locally or on origin, so \`gh release create\` would create it on the fly.`
      : 'no release ref was given, so the tag it would create cannot be verified.'
  return (
    [
      `[release-tag-tied-guard] Blocked: ${reason}`,
      '',
      '  A GitHub release must be tied to an EXISTING tag. Push the tag first,',
      '  then create the release for it:',
      '',
      '    git tag vX.Y.Z <commit> && git push origin vX.Y.Z',
      '    gh release create vX.Y.Z --verify-tag …',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard((command, payload) => {
  const detection = detectReleaseCreate(command)
  if (!detection.detected) {
    return undefined
  }

  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd()
  if (!detection.hasTarget && tagExists(detection.ref, cwd)) {
    // Existing tag, no --target: the legitimate backfill — allow.
    return undefined
  }

  return block(formatBlock(detection))
})

export const hook = defineHook({
  bypass: ['arbitrary-release'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
