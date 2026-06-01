#!/usr/bin/env node
// Claude Code PreToolUse hook — target-arch-env-guard.
//
// Blocks Edit/Write to builder scripts that read
// `process.env.TARGET_ARCH` and spawn `make` / `configure` without
// `delete process.env.TARGET_ARCH`.
//
// Background: GNU make's implicit-rule recipe expands $(TARGET_ARCH)
// into the gcc command line. When TARGET_ARCH is set as an env var,
// make picks it up and gcc fails with:
//
//   gcc: error: x64: linker input file not found
//
// Incident: libpq.yml 26351344690 (2026-05-24). Every Linux + darwin
// platform failed at `make -j -C src/common`.
//
// Conservative detection — only blocks when ALL three are true:
//   1. file references `process.env.TARGET_ARCH`
//   2. file spawns `make` or `configure`
//   3. file does NOT contain `delete .*TARGET_ARCH`
//
// Bypass: `Allow target-arch-env bypass` typed verbatim.
//
// Fails open on regex errors.

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow target-arch-env bypass'

const BUILDER_SCRIPT_RE =
  /(?:^|\/)(?:packages\/[^/]+\/scripts\/|scripts\/)[^/]+\.(?:mts|ts|js|mjs|cjs)$/i

// `process.env.TARGET_ARCH` — read or assignment.
const READS_TARGET_ARCH_RE = /\bprocess\.env\.TARGET_ARCH\b/

// `delete process.env.TARGET_ARCH` OR `delete <anything>.TARGET_ARCH`.
const DELETES_TARGET_ARCH_RE = /\bdelete\s+[\w.]+\.TARGET_ARCH\b/

// Spawn surfaces for `make` or `configure`. Covers:
//   spawn('make', ...)              -> `spawn\(['"]make['"]`
//   spawnSync('make', ...)
//   execSync('make ...')            -> command-string form
//   exec('make -j ...')             -> command-string form
//   `make ${args}` template literal
//   ['make', '-j']                  -> array literal first element
//   './configure'                   -> literal
//   `bash configure`                -> literal
//
// The check is intentionally loose — false positives are OK (the
// fix is cheap; just add the delete). False negatives are the
// failure mode that previously cost a CI dispatch.
const SPAWNS_MAKE_OR_CONFIGURE_RE =
  /(?:\bspawn(?:Sync)?\s*\(\s*['"`]make['"`]|\b(?:exec|execSync|spawn(?:Sync)?)\s*\(\s*['"`]make\b|['"`]make\s+-[a-zA-Z]|\[\s*['"`]make['"`]\s*,|\.\/configure\b|\bbash\s+configure\b|\bsh\s+configure\b)/

export function isBuilderScript(filePath: string): boolean {
  return BUILDER_SCRIPT_RE.test(filePath.replace(/\\/g, '/'))
}

export function classifyText(text: string): {
  reads: boolean
  spawnsTarget: boolean
  deletes: boolean
} {
  return {
    reads: READS_TARGET_ARCH_RE.test(text),
    spawnsTarget: SPAWNS_MAKE_OR_CONFIGURE_RE.test(text),
    deletes: DELETES_TARGET_ARCH_RE.test(text),
  }
}

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content, payload) => {
  if (!isBuilderScript(filePath)) {
    return
  }

  const currentText = readFileSafe(filePath)
  let afterText: string
  if (payload.tool_name === 'Write') {
    afterText = content ?? ''
  } else {
    const oldStr = (payload.tool_input?.old_string as string | undefined) ?? ''
    const newStr = content ?? ''
    if (!oldStr) {
      return
    }
    if (!currentText.includes(oldStr)) {
      return
    }
    afterText = currentText.replace(oldStr, newStr)
  }

  const c = classifyText(afterText)
  // Only block when ALL three conditions hold:
  //   reads TARGET_ARCH AND spawns make/configure AND has no delete.
  if (!c.reads || !c.spawnsTarget || c.deletes) {
    return
  }
  // Don't block if the same combination was already present in the
  // before-text — the regression isn't this edit.
  const cb = classifyText(currentText)
  if (cb.reads && cb.spawnsTarget && !cb.deletes) {
    return
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }

  logger.error(
    [
      '[target-arch-env-guard] Blocked: TARGET_ARCH env-var collision risk',
      '',
      `  File: ${filePath}`,
      '',
      '  This script reads `process.env.TARGET_ARCH` and spawns `make`',
      '  or `configure`, but never calls `delete process.env.TARGET_ARCH`.',
      '',
      '  Risk: GNU make implicit rule `%.o : %.c` expands $(TARGET_ARCH)',
      '  into the gcc command line. With TARGET_ARCH inherited from the',
      '  environment (e.g. "x64"), gcc fails with:',
      '',
      '    gcc: error: x64: linker input file not found',
      '',
      '  Past incident: libpq.yml 26351344690 (2026-05-24) — every Linux',
      '  + darwin platform failed at `make -j -C src/common`.',
      '',
      '  Fix: after reading the value, delete it from process.env:',
      '',
      '    const TARGET_ARCH = process.env.TARGET_ARCH || process.arch',
      '    delete process.env.TARGET_ARCH',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
