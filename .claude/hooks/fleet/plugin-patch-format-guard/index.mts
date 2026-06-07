#!/usr/bin/env node
// Claude Code PreToolUse hook — plugin-patch-format-guard.
//
// Blocks Edit/Write tool calls that would write a plugin-cache patch
// (`scripts/fleet/plugin-patches/*.patch`) in a non-canonical shape. The
// runtime consumer is `install-claude-plugins.mts`'s
// `reapplyPluginPatches()`, which: parses the filename via
// `parsePatchFileName`, strips the `# @key: value` header via
// `stripPatchHeader`, then feeds the body to `patch -p1`. A patch that
// doesn't match the convention is silently skipped (or worse, fails to
// apply) at reconcile time — this hook catches the mistake at edit time.
//
// What it enforces (full spec: docs/claude.md/fleet/plugin-cache-patches.md):
//
//   1. Filename `<plugin>-<version>-<slug>.patch` — lowercase-kebab
//      plugin, dotted semver version, lowercase-kebab slug.
//   2. Four required `# @key:` header lines: @plugin, @plugin-version,
//      @sha, @description.
//   3. A PLAIN `diff -u` body: must have a `--- ` line, must NOT carry
//      git-diff markers (`diff --git`, `index ab..cd`, `new file mode`).
//      `patch` doesn't expect git markers; they break the apply.
//   4. The `# @plugin-version:` value must match the version embedded in
//      the filename (best-effort cross-check).
//
// Validation needs the WHOLE file content. Write passes it as
// `tool_input.content`. Edit only passes a `new_string` fragment — we
// can't see the surrounding file, so an Edit without `content` is
// skipped (documented limitation; the commit-time path / the next Write
// catch it). No bypass — this is a pure format gate, not a policy gate.
//
// Exit code 2 makes Claude Code refuse the tool call.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Fails open on hook bugs (exit 0 + stderr log).

import process from 'node:process'

import {
  isAbsolute,
  normalizePath,
} from '@socketsecurity/lib-stable/paths/normalize'

import { readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?:
    | {
        content?: string | undefined
        file_path?: string | undefined
        new_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
}

// <plugin>-<version>-<slug>.patch — lowercase-kebab plugin, dotted
// semver version, lowercase-kebab slug. Mirrors `PATCH_FILE_NAME` in
// scripts/fleet/install-claude-plugins.mts so the hook and the consumer agree.
const PATCH_FILE_NAME = /^[a-z0-9-]+-(\d+\.\d+\.\d+)-[a-z0-9-]+\.patch$/

// The four header keys the consumer's provenance block requires.
const REQUIRED_HEADER_KEYS = [
  '@plugin',
  '@plugin-version',
  '@sha',
  '@description',
] as const

// Line-start `# @plugin-version: <semver>` — used to cross-check the
// header version against the filename version.
const HEADER_PLUGIN_VERSION = /^# @plugin-version:\s*(\d+\.\d+\.\d+)\s*$/m

type Verdict = { ok: true } | { ok: false; reason: string }

/**
 * Is the target file path a plugin-cache patch under
 * `scripts/fleet/plugin-patches/`? Normalizes to `/`-separators first so the
 * check is cross-platform (per the fleet path-regex-normalize rule), then
 * matches the canonical dir + `.patch` extension.
 */
export function isPluginPatchPath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  // Match the dir segment with or without a leading slash so a (malformed)
  // relative path is still recognized as a plugin patch — the caller then
  // flags the non-absolute path rather than letting it slip past as "not a
  // patch". `/scripts/plugin-patches/` (mid-path) and `scripts/fleet/plugin-patches/`
  // (path start) both count.
  return (
    /(?:^|\/)scripts\/plugin-patches\//.test(normalized) &&
    normalized.endsWith('.patch')
  )
}

/**
 * Pure classifier: given a patch filename + its full content, return a verdict.
 * Exported for unit tests. Mirrors the runtime contract of
 * `install-claude-plugins.mts` (filename → cache dir, header → provenance,
 * plain `diff -u` body → `patch -p1`).
 */
export function classifyPluginPatch(
  fileName: string,
  content: string,
): Verdict {
  // (1) Filename shape.
  const nameMatch = PATCH_FILE_NAME.exec(fileName)
  if (!nameMatch) {
    return {
      ok: false,
      reason:
        `Filename "${fileName}" must match <plugin>-<version>-<slug>.patch ` +
        '(lowercase-kebab plugin, dotted semver version, lowercase-kebab ' +
        'slug). Example: codex-1.0.1-stdin-eagain.patch.',
    }
  }
  const fileVersion = nameMatch[1]!

  // (2) Required header keys, each as a line-start `# @key:` comment.
  const missing: string[] = []
  for (let i = 0, { length } = REQUIRED_HEADER_KEYS; i < length; i += 1) {
    const key = REQUIRED_HEADER_KEYS[i]!
    const re = new RegExp(`^# ${key}:`, 'm')
    if (!re.test(content)) {
      missing.push(`# ${key}:`)
    }
  }
  if (missing.length) {
    return {
      ok: false,
      reason:
        `Missing required header line(s): ${missing.join(', ')}. Every ` +
        'plugin patch needs a `# @plugin:` / `# @plugin-version:` / ' +
        '`# @sha:` / `# @description:` provenance header above the diff.',
    }
  }

  // (3) Plain unified diff body — must have a `--- ` line.
  if (!/^--- /m.test(content)) {
    return {
      ok: false,
      reason:
        'No `--- ` line found. The body must be a plain unified diff ' +
        '(`diff -u` output) — `reapplyPluginPatches()` strips everything ' +
        'before the first `--- ` line and feeds the rest to `patch -p1`.',
    }
  }

  // (3b) Reject git-diff markers — `patch` doesn't expect them.
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('diff --git ')) {
      return {
        ok: false,
        reason:
          'Body is a `git diff` (found `diff --git`). Use a plain ' +
          '`diff -u a/file b/file` instead — git markers break `patch -p1`. ' +
          'Regenerate via the regenerating-patches skill.',
      }
    }
    if (/^index [0-9a-f]+\.\./.test(line)) {
      return {
        ok: false,
        reason:
          'Body has a git `index <hash>..<hash>` line. Use a plain ' +
          '`diff -u` body (no git markers); regenerate via the ' +
          'regenerating-patches skill.',
      }
    }
    if (line.startsWith('new file mode ')) {
      return {
        ok: false,
        reason:
          'Body has a git `new file mode` line. Use a plain `diff -u` ' +
          'body (no git markers); regenerate via the ' +
          'regenerating-patches skill.',
      }
    }
  }

  // (4) Cross-check the header version against the filename version.
  const headerMatch = HEADER_PLUGIN_VERSION.exec(content)
  if (headerMatch) {
    const headerVersion = headerMatch[1]!
    if (headerVersion !== fileVersion) {
      return {
        ok: false,
        reason:
          `Version mismatch: filename says ${fileVersion}, ` +
          `\`# @plugin-version:\` says ${headerVersion}. They map to the ` +
          'same plugin-cache dir, so they must agree. Fix one to match.',
      }
    }
  }

  return { ok: true }
}

export function emitBlock(filePath: string, reason: string): void {
  const lines: string[] = []
  lines.push('[plugin-patch-format-guard] Blocked: malformed plugin patch.')
  lines.push(`  File:  ${filePath}`)
  lines.push(`  Issue: ${reason}`)
  lines.push('')
  lines.push('  A plugin-cache patch must be:')
  lines.push('    - named <plugin>-<version>-<slug>.patch (dotted semver),')
  lines.push(
    '    - headed by # @plugin: / # @plugin-version: / # @sha: / # @description:,',
  )
  lines.push(
    '    - a plain `diff -u` body (a/… b/…, NO `diff --git`/`index`/`mode`).',
  )
  lines.push('  Spec: docs/claude.md/fleet/plugin-cache-patches.md')
  process.stderr.write(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!filePath || !isPluginPatchPath(filePath)) {
    return
  }
  // PreToolUse always hands hooks an absolute file_path. A relative one is
  // anomalous — the path-match + filename-derivation below assume an absolute
  // path, so flag it rather than silently mis-derive the cache mapping.
  if (!isAbsolute(filePath)) {
    process.stderr.write(
      `[plugin-patch-format-guard] Blocked: file_path must be absolute.\n` +
        `  Where: tool_input.file_path = "${filePath}"\n` +
        `  Saw:   a relative path; wanted an absolute path (PreToolUse ` +
        `always passes one).\n` +
        `  Fix:   pass the absolute path to the patch under ` +
        `scripts/fleet/plugin-patches/.\n`,
    )
    process.exitCode = 2
    return
  }
  // Validation needs the whole file. Write carries it in `content`; an
  // Edit only carries a `new_string` fragment, so we can't see the full
  // file — skip the Edit-without-content case rather than guess.
  const content = payload.tool_input?.content
  if (typeof content !== 'string') {
    return
  }
  const fileName = normalizePath(filePath).split('/').pop() ?? ''
  const verdict = classifyPluginPatch(fileName, content)
  if (verdict.ok) {
    return
  }
  emitBlock(filePath, verdict.reason)
  process.exitCode = 2
}

main().catch(e => {
  process.stderr.write(
    `[plugin-patch-format-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
