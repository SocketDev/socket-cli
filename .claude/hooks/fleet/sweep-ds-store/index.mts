#!/usr/bin/env node
// Claude Code Stop hook — sweep-ds-store.
//
// Fires at turn-end. Walks the worktree (current working directory)
// and deletes any `.DS_Store` files Finder created mid-session.
// Excludes `.git/` and `node_modules/` so we don't churn through
// directories full of vendor noise.
//
// Why a hook instead of `.gitignore` alone:
//   `.DS_Store` is gitignored fleet-wide, but the FILES themselves
//   still exist on disk. They surface in:
//     - `find` output, polluting search results
//     - `git status --ignored` reports
//     - non-git tooling (rsync, tar, zip)
//     - Spotlight indexing churn
//   The right fix is to delete them, not just ignore them.
//
// Silent on the happy path. When files are found, logs:
//
//   [sweep-ds-store] swept N .DS_Store file(s):
//     ./path/to/.DS_Store
//     ...
//
// No bypass — `.DS_Store` is never wanted in a repo. If you have a
// reason to keep one (very rare — testing macOS-specific code), use
// a name like `.DS_Store.fixture` and adjust the test fixture.
//
// Stop hooks receive a JSON payload on stdin but the body shape is
// irrelevant here; we ignore it. Drains the pipe so the upstream
// doesn't buffer-stall.

import { existsSync, promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const TARGET = '.DS_Store'
const EXCLUDE_DIRS = new Set(['.git', 'node_modules'])
const MAX_DEPTH = 12

interface SweepResult {
  readonly swept: readonly string[]
  readonly errors: readonly string[]
}

/**
 * Recursively walk `root`, deleting every `.DS_Store` found. Returns the list
 * of deleted paths (relative to `root`) and any per-file delete errors. Never
 * throws — Stop hooks must not block the conversation on their own bugs.
 *
 * `MAX_DEPTH` is a defense against pathological symlink loops; the worktrees we
 * run on don't nest anywhere near that deep.
 */
export async function sweepDsStore(root: string): Promise<SweepResult> {
  const swept: string[] = []
  const errors: string[] = []
  await walk(root, root, 0, swept, errors)
  return { swept, errors }
}

async function walk(
  root: string,
  dir: string,
  depth: number,
  swept: string[],
  errors: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) {
    return
  }
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // Permission denied, race with another process, etc. Skip the
    // dir; never block the hook.
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const name = entry.name
    const full = path.join(dir, name)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) {
        continue
      }
      // Avoid following symlinks — keeps the walk to the working
      // tree, not whatever a symlink points at.
      if (entry.isSymbolicLink()) {
        continue
      }
      await walk(root, full, depth + 1, swept, errors)
      continue
    }
    if (name === TARGET) {
      try {
        await safeDelete(full)
        swept.push(path.relative(root, full))
      } catch (e) {
        errors.push(`${path.relative(root, full)}: ${(e as Error).message}`)
      }
    }
  }
}

async function main(): Promise<void> {
  // Drain stdin so the upstream pipe doesn't buffer-stall, but ignore
  // the body — Stop hooks pass a JSON payload that we don't need.
  process.stdin.resume()
  process.stdin.on('data', () => {})
  // Short timeout — if stdin never closes we still want to run.
  await new Promise<void>(resolve => {
    process.stdin.on('end', () => resolve())
    setTimeout(() => resolve(), 100)
  })

  const root = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  if (!existsSync(root)) {
    return
  }
  const { swept, errors } = await sweepDsStore(root)
  if (swept.length === 0 && errors.length === 0) {
    return
  }
  const lines: string[] = []
  if (swept.length > 0) {
    lines.push(`[sweep-ds-store] swept ${swept.length} .DS_Store file(s):`)
    for (let i = 0, { length } = swept; i < length; i += 1) {
      lines.push(`  ${swept[i]!}`)
    }
  }
  if (errors.length > 0) {
    lines.push(`[sweep-ds-store] ${errors.length} delete error(s):`)
    for (let i = 0, { length } = errors; i < length; i += 1) {
      lines.push(`  ${errors[i]!}`)
    }
  }
  process.stderr.write(lines.join(os.EOL) + os.EOL)
}

// CLI entrypoint — only fires when this file is the main module so
// the test importer can pull `sweepDsStore` without triggering the
// stdin reader.
if (process.argv[1]?.endsWith('index.mts')) {
  main().catch(e => {
    process.stderr.write(
      `[sweep-ds-store] hook error (allowing): ${(e as Error).message}${os.EOL}`,
    )
  })
}
