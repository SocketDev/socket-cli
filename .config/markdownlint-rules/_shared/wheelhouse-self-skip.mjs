/**
 * @file Shared helper for fleet markdown rules: detect whether the lint
 *   is running inside socket-wheelhouse itself, in which case the rule
 *   should bail. The custom rules in this directory exist to protect
 *   PUBLIC fleet consumers from leaking internal scaffolding; wheelhouse
 *   referencing itself in its own docs is the canonical case and must
 *   not trigger.
 *
 *   Detection prefers explicit env override (CI sets
 *   SOCKET_FLEET_REPO_NAME) then falls back to checking the cwd's
 *   basename and git remote.
 */

import { execSync } from 'node:child_process'
import path from 'node:path'

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
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return /[/:]socket-wheelhouse(?:\.git)?$/.test(remote)
  } catch {
    return false
  }
}
