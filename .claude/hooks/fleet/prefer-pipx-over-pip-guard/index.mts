#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-pipx-over-pip-guard.
//
// Blocks `pip install <pkg>` / `pip3 install <pkg>` /
// `python -m pip install <pkg>` in three surfaces:
//
//   1. Bash tool invocations (`tool_name === 'Bash'`)
//   2. Edit/Write on Dockerfiles (`Dockerfile*`)
//   3. Edit/Write on shell scripts (`*.sh`, `*.bash`)
//
// Allowed: `pip install pipx` (bootstrap), `pip install -e .`
// (editable install of the current project), `pip install -r
// <file>` (requirements file), comment-only mentions, and
// `pip install --user pipx` patterns used by setup-pipx itself.
//
// Bypass: `Allow pip-install bypass` typed verbatim in a recent
// user turn. Fails open on regex / parse errors.

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow pip-install bypass'

// Files in scope for Edit/Write inspection. Markdown is OUT — error
// messages telling the human user "install with: pip install X" live
// in docs and are recovery instructions, not active build steps.
const FILE_SCOPE_RE =
  /(?:^|\/)Dockerfile(?:\.[^\s/]+)?$|\.(?:sh|bash|dockerfile)$/i

// Match a pip-install invocation anywhere in a line. Tolerates:
//   pip install <pkg>
//   pip3 install <pkg>
//   python -m pip install <pkg>      (python, python3, python3.12, py)
//   /path/to/pip install <pkg>
//   sudo pip install <pkg>
// Captures the part AFTER `install` so the allowlist check can read it.
const PIP_INSTALL_RE =
  /(?<![\w/-])(?:(?:python[\d.]*|py)\s+-m\s+)?\b(?:sudo\s+)?(?:[/\w.-]+\/)?pip[\d.]*\s+install\b([^\n;&|]*)/g

// Allowlist matchers applied to the captured "rest of args" string.
//   - Bootstrap pipx itself: `pip install pipx` (any flags, any version)
//   - Editable install of current project: `-e .` or `-e ./`
//   - Requirements file: `-r <path>` or `--requirement <path>`
//   - Setup-pipx self-bootstrap: `--user pipx` with no other targets
//   - `--help` / `-h` invocations
function isAllowedInstall(restOfArgs: string): boolean {
  const trimmed = restOfArgs.trim()
  if (trimmed === '' || /^(?:-h|--help)\b/.test(trimmed)) {
    return true
  }
  // `pip install pipx`, `pip install --user pipx`, `pip install -U pipx`
  // (any flags but the only target is pipx).
  if (/(?:^|\s)pipx(?:==|\s|$)/.test(trimmed)) {
    const targets = trimmed.split(/\s+/).filter(t => t && !t.startsWith('-'))
    if (targets.length === 1 && /^pipx(==.*)?$/.test(targets[0]!)) {
      return true
    }
  }
  // Editable install of current project (`. ` or `./`).
  if (/(?:^|\s)-e\s+\.\/?(\s|$)/.test(trimmed)) {
    return true
  }
  // Requirements file install.
  if (/(?:^|\s)(?:-r|--requirement)\s+\S/.test(trimmed)) {
    return true
  }
  return false
}

// Strip line comments (Dockerfile + shell use `#`). Leaves quoted
// strings alone so `echo "# pip install foo"` stays intact.
export function stripLineComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inSingle) {
      if (ch === "'") {
        inSingle = false
      }
      continue
    }
    if (inDouble) {
      if (ch === '"' && line[i - 1] !== '\\') {
        inDouble = false
      }
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

interface Finding {
  line: number
  source: string
  args: string
}

// Scan a text buffer (Bash command, Dockerfile body, shell script)
// for `pip install <not-allowed>` patterns. Returns one Finding per
// hit line. Comments are stripped before matching.
export function findPipInstalls(text: string): Finding[] {
  const lines = text.split('\n')
  const findings: Finding[] = []
  for (let i = 0; i < lines.length; i += 1) {
    /* c8 ignore next - String.prototype.split always returns defined elements */
    const raw = lines[i] ?? ''
    const code = stripLineComment(raw)
    if (!code.includes('pip')) {
      continue
    }
    PIP_INSTALL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PIP_INSTALL_RE.exec(code)) !== null) {
      /* c8 ignore next - regex group 1 is always defined when the pattern matches */
      const args = (m[1] ?? '').trim()
      if (isAllowedInstall(args)) {
        continue
      }
      findings.push({
        line: i + 1,
        source: raw.trim(),
        args,
      })
    }
  }
  return findings
}

export function isFileInScope(filePath: string): boolean {
  return FILE_SCOPE_RE.test(filePath)
}

export function buildBlockMessage(
  context: string,
  findings: Finding[],
): string {
  const lines: string[] = [
    '[prefer-pipx-over-pip-guard] Blocked: `pip install <pkg>` is not the fleet path',
    '',
    `  Context: ${context}`,
    '',
  ]
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  • line ${f.line}: pip install ${f.args || '<args>'}`)
  }
  lines.push(
    '',
    "  `pip install <pkg>` pollutes the host Python's site-packages",
    '  and leaves the version floating. The fleet pins installs via',
    '  pipx (one tool, one venv, one exact version):',
    '',
    '    pipx install <pkg>==<exact-version>          # PyPI release',
    '    pipx install git+https://...@<sha>           # git-SHA pin',
    '',
    '  For a host without pipx:',
    '    node .claude/hooks/fleet/setup-pipx/install.mts',
    '',
    '  Allowed (these pass without bypass):',
    '    pip install pipx           # bootstrap pipx itself',
    '    pip install -e .           # editable current project',
    '    pip install -r <file>      # requirements file (already pinned)',
    '',
    `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
    '',
  )
  return lines.join('\n')
}

export const hook = defineHook({
  check(payload) {
    const tool = payload?.tool_name
    if (tool !== 'Bash' && tool !== 'Edit' && tool !== 'Write') {
      return undefined
    }
    const input = payload.tool_input as
      | {
          command?: string | undefined
          file_path?: string | undefined
          new_string?: string | undefined
          old_string?: string | undefined
          content?: string | undefined
        }
      | undefined
    let scanText = ''
    let context = ''
    if (tool === 'Bash') {
      const cmd = input?.command
      if (!cmd) {
        return undefined
      }
      scanText = cmd
      context = '<Bash command>'
    } else {
      const filePath = input?.file_path
      if (!filePath || !isFileInScope(filePath)) {
        return undefined
      }
      if (tool === 'Write') {
        scanText = input?.content ?? input?.new_string ?? ''
        context = filePath
      } else {
        const oldStr = input?.old_string ?? ''
        const newStr = input?.new_string ?? ''
        if (!oldStr) {
          return undefined
        }
        const currentText = safeReadFileSync(filePath) ?? ''
        if (!currentText.includes(oldStr)) {
          return undefined
        }
        const afterText = currentText.replace(oldStr, newStr)
        // Only flag NEW violations the edit introduces.
        const beforeFindings = findPipInstalls(currentText).map(
          f => `${f.line}:${f.source}`,
        )
        const beforeSet = new Set(beforeFindings)
        const afterFindings = findPipInstalls(afterText)
        const newFindings = afterFindings.filter(
          f => !beforeSet.has(`${f.line}:${f.source}`),
        )
        if (newFindings.length === 0) {
          return undefined
        }
        if (
          payload.transcript_path &&
          bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
        ) {
          return undefined
        }
        return block(buildBlockMessage(filePath, newFindings))
      }
    }
    const findings = findPipInstalls(scanText)
    if (findings.length === 0) {
      return undefined
    }
    if (
      payload.transcript_path &&
      bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
    ) {
      return undefined
    }
    return block(buildBlockMessage(context, findings))
  },
  event: 'PreToolUse',
  matcher: ['Bash', 'Edit', 'Write'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
