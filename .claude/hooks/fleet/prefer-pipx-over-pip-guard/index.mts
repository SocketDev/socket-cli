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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly command?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly old_string?: string | undefined
        readonly content?: string | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow pip-install bypass'

// Files in scope for Edit/Write inspection. Markdown is OUT — error
// messages telling the human user "install with: pip install X" live
// in docs and are recovery instructions, not active build steps.
const FILE_SCOPE_RE = /(?:^|\/)Dockerfile(?:\.[^\s/]+)?$|\.(?:sh|bash|dockerfile)$/i

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
    const targets = trimmed
      .split(/\s+/)
      .filter(t => t && !t.startsWith('-'))
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
    const raw = lines[i] ?? ''
    const code = stripLineComment(raw)
    if (!code.includes('pip')) {
      continue
    }
    PIP_INSTALL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PIP_INSTALL_RE.exec(code)) !== null) {
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

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

function isFileInScope(filePath: string): boolean {
  return FILE_SCOPE_RE.test(filePath)
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }

  let scanText = ''
  let context = ''
  if (payload.tool_name === 'Bash') {
    const cmd = payload.tool_input?.command
    if (!cmd) {
      process.exit(0)
    }
    scanText = cmd
    context = '<Bash command>'
  } else if (payload.tool_name === 'Edit' || payload.tool_name === 'Write') {
    const filePath = payload.tool_input?.file_path
    if (!filePath || !isFileInScope(filePath)) {
      process.exit(0)
    }
    if (payload.tool_name === 'Write') {
      scanText = payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
    } else {
      const oldStr = payload.tool_input?.old_string ?? ''
      const newStr = payload.tool_input?.new_string ?? ''
      if (!oldStr) {
        process.exit(0)
      }
      const currentText = readFileSafe(filePath)
      if (!currentText.includes(oldStr)) {
        process.exit(0)
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
        process.exit(0)
      }
      reportFindings(filePath, newFindings, payload.transcript_path)
      return
    }
    context = filePath
  } else {
    process.exit(0)
  }

  const findings = findPipInstalls(scanText)
  if (findings.length === 0) {
    process.exit(0)
  }
  reportFindings(context, findings, payload.transcript_path)
}

function reportFindings(
  context: string,
  findings: Finding[],
  transcriptPath: string | undefined,
): void {
  if (transcriptPath && bypassPhrasePresent(transcriptPath, BYPASS_PHRASE)) {
    process.exit(0)
  }
  const lines: string[] = [
    '[prefer-pipx-over-pip-guard] Blocked: `pip install <pkg>` is not the fleet path',
    '',
    `  Context: ${context}`,
    '',
  ]
  for (const f of findings) {
    lines.push(`  • line ${f.line}: pip install ${f.args || '<args>'}`)
  }
  lines.push(
    '',
    '  `pip install <pkg>` pollutes the host Python\'s site-packages',
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
  process.stderr.write(lines.join('\n'))
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[prefer-pipx-over-pip-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})
