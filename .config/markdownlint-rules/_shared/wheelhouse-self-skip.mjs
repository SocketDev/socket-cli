/**
 * @file Shared helper for fleet markdown rules: detect whether the lint is
 *   running inside socket-wheelhouse itself, in which case the rule should
 *   bail. The custom rules in this directory exist to protect PUBLIC fleet
 *   consumers from leaking internal scaffolding; wheelhouse referencing itself
 *   in its own docs is the canonical case and must not trigger. Detection
 *   prefers explicit env override (CI sets SOCKET_FLEET_REPO_NAME) then falls
 *   back to checking the cwd's basename and git remote.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- markdownlint-cli2 calls isInsideWheelhouse() synchronously at rule init; an async spawn would require the rule loader to await, which markdownlint-cli2 doesnt support.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

export function isInsideWheelhouse() {
  const envName = process.env['SOCKET_FLEET_REPO_NAME']
  if (envName) {
    return envName === 'socket-wheelhouse'
  }
  const cwd = process.cwd()
  if (path.basename(cwd) === 'socket-wheelhouse') {
    return true
  }
  // Fallback: probe the git remote URL. Tolerates renamed local
  // checkout dirs (`~/projects/wheelhouse/` would still match).
  // spawnSync (not execSync) — array args, no shell interpolation.
  // This file is loaded by markdownlint-cli2 as a regular ESM module,
  // not bundled, so we cant pull in @socketsecurity/lib-stable/spawn —
  // node:child_process spawnSync is the canonical fallback.
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.status !== 0 || !r.stdout) {
    return false
  }
  const remote = r.stdout.toString().trim()
  return /[/:]socket-wheelhouse(?:\.git)?$/.test(remote)
}
