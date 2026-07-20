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
// Fails open on regex errors.

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'

// Match builder script paths: a file directly inside a top-level `scripts/`
// dir or a per-package `packages/<name>/scripts/` dir, with a JS/TS
// extension (mts, ts, js, mjs, cjs). Anchors to a path segment boundary so
// a bare filename without a leading slash also matches.
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
  return BUILDER_SCRIPT_RE.test(normalizePath(filePath))
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

export const check = editGuard((filePath, _content, payload) => {
  if (!isBuilderScript(filePath)) {
    return undefined
  }

  const currentText = safeReadFileSync(filePath) ?? ''
  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  const c = classifyText(afterText)
  // Only block when ALL three conditions hold:
  //   reads TARGET_ARCH AND spawns make/configure AND has no delete.
  if (!c.reads || !c.spawnsTarget || c.deletes) {
    return undefined
  }
  // Don't block if the same combination was already present in the
  // before-text — the regression isn't this edit.
  const cb = classifyText(currentText)
  if (cb.reads && cb.spawnsTarget && !cb.deletes) {
    return undefined
  }

  return block(
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
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['target-arch-env'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
