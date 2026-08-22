/**
 * Practice checks for the doctor command: the enforcement twin of the
 * skills' guidance, run without an agent present.
 *
 * - Workflows: a repo with CI should run Socket in it (the Socket action, a
 *   Socket CLI call, or an sfw-wrapped install somewhere).
 * - Sfw: every package-manager install invocation is sfw-wrapped, in package.json
 *   scripts and in workflows alike. A bare `npm install` is where the malicious
 *   package lands.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type PracticeViolation = {
  file: string
  line: number
  practice: 'sfw' | 'workflows'
  text: string
}

const WORKFLOW_SOCKET_RE =
  /SocketDev\/action|socket\.dev\/action|@socketsecurity|\bsfw\b|socket scan|socket run|socket firewall/i

// ^\s*-?\s*          — optional YAML list-item dash, e.g. a workflow `run:` step
// (?:run:\s*)?       — optional YAML `run:` key
// (?:sudo\s+)?       — optional sudo prefix
// (?:npm ci|...)     — the bare install command itself
const BARE_INSTALL_RE =
  /^\s*-?\s*(?:run:\s*)?(?:sudo\s+)?(?:npm ci|npm install|pnpm install|pnpm i|yarn install|yarn add|pip install|uv pip install|cargo fetch|cargo install)\b/

/**
 * Every bare package-manager install in package.json scripts and
 * .github/workflows, reported per file and line. A line already carrying
 * `sfw` passes; comments and non-install lines never reach the matcher.
 */
export function checkSfwWrap(root: string): PracticeViolation[] {
  const violations: PracticeViolation[] = []
  const scanLines = (rel: string, content: string) => {
    const lines = content.split(/\r?\n/)
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]!
      const trimmed = line.trimStart()
      if (trimmed.startsWith('#')) {
        continue
      }
      const match = BARE_INSTALL_RE.exec(line)
      if (match && !isSfwWrapped(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          practice: 'sfw',
          text: trimmed,
        })
      }
    }
  }

  const pkgPath = path.join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      for (const [name, body] of Object.entries(
        (pkg['scripts'] ?? {}) as Record<string, string>,
      )) {
        if (BARE_INSTALL_RE.test(`run: ${body}`) && !isSfwWrapped(body)) {
          violations.push({
            file: 'package.json',
            line: 0,
            practice: 'sfw',
            text: `${name}: ${body}`,
          })
        }
      }
    } catch {
      // Unreadable package.json - the env gate reports it elsewhere.
    }
  }

  const workflowsDir = path.join(root, '.github', 'workflows')
  if (existsSync(workflowsDir)) {
    for (const file of readdirSync(workflowsDir)) {
      if (!/\.(?:yaml|yml)$/.test(file)) {
        continue
      }
      const rel = path.join('.github', 'workflows', file)
      scanLines(rel, readFileSync(path.join(workflowsDir, file), 'utf8'))
    }
  }
  return violations
}

/**
 * A repo with workflows should run Socket somewhere in them - the Socket
 * action, a Socket CLI invocation, or an sfw-wrapped step. One violation
 * when every workflow is Socket-free; none when any workflow carries it.
 */
export function checkWorkflowSocket(root: string): PracticeViolation[] {
  const workflowsDir = path.join(root, '.github', 'workflows')
  if (!existsSync(workflowsDir)) {
    return []
  }
  const files = readdirSync(workflowsDir).filter(f => /\.(?:yaml|yml)$/.test(f))
  if (files.length === 0) {
    return []
  }
  const carriesSocket = files.some(file =>
    WORKFLOW_SOCKET_RE.test(
      readFileSync(path.join(workflowsDir, file), 'utf8'),
    ),
  )
  return carriesSocket
    ? []
    : [
        {
          file: '.github/workflows/',
          line: 0,
          practice: 'workflows',
          text: 'no workflow runs Socket (SocketDev/action, socket CLI, or sfw)',
        },
      ]
}

export function isSfwWrapped(line: string): boolean {
  return /\bsfw\b/.test(line)
}
