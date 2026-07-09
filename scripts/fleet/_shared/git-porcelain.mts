/**
 * @file Shared `gitPorcelain` helper — an UNTRIMMED `git status --porcelain`
 *   read. The lib-stable `spawnSync` default `stdioString:true` trims leading
 *   whitespace from stdout, which eats the status-space in porcelain's two-char
 *   status column (a ` M path` first line becomes `M path`, shifting every
 *   parsed field by one char and corrupting the result). This helper uses
 *   `stdioString: false` to get a raw Buffer, stringifies without trim, and
 *   returns the untrimmed string ready for `parsePorcelain`. Consumers:
 *   `scripts/fleet/land-work.mts` has its own inlined copy of this logic
 *   (because it predates this module); new callers should import from here.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- sync helper; callers are sync check scripts needing a one-shot status read before git ops.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

export interface PorcelainEntry {
  /**
   * Two-char porcelain status (e.g. `' M'`, `'??'`, `'R '`).
   */
  readonly status: string
  /**
   * Repo-relative path (rename entries resolve to the NEW path).
   */
  readonly path: string
}

export interface GitPorcelainResult {
  readonly ok: boolean
  /**
   * Untrimmed stdout from `git status --porcelain`.
   */
  readonly raw: string
  readonly entries: PorcelainEntry[]
}

/**
 * Run `git status --porcelain [--untracked-files=all]` in `cwd` and return the
 * raw output + parsed entries. The raw Buffer is stringified WITHOUT trim so
 * leading-space status chars (e.g. ` M` for worktree-modified) survive.
 *
 * Options:
 * - `unatrackedAll` — pass `--untracked-files=all`; expands new directories
 * to individual file entries instead of collapsing to `?? dir/`.
 */
export function gitPorcelain(
  cwd: string,
  options: { untrackedAll?: boolean | undefined } = {},
): GitPorcelainResult {
  const opts = { __proto__: null, ...options } as typeof options
  const args = ['status', '--porcelain']
  if (opts.untrackedAll) {
    args.push('--untracked-files=all')
  }
  // stdioString:false → raw Buffer stdout, NOT a trimmed string.
  // `git status --porcelain` encodes the staged/unstaged state in the FIRST
  // two columns; the unstaged form starts with a space (' M path'). The
  // lib-stable default (stdioString:true) trims leading whitespace, eating
  // that leading space on the first line and shifting every parsed path left
  // by one char. Read raw and stringify ourselves.
  const r = spawnSync('git', args, {
    cwd,
    stdioString: false,
    timeout: 60_000,
  })
  const ok = r.status === 0
  const stdout = String(r.stdout ?? '')
  return {
    ok,
    raw: ok ? stdout : '',
    entries: ok ? parsePorcelain(stdout) : [],
  }
}

/**
 * Parse the untrimmed output of `git status --porcelain` into discrete entries.
 * Rename entries (`R old -> new`) resolve to the NEW path. Pure; no I/O.
 *
 * The two-char status at columns 0–1 is preserved verbatim. Example inputs:
 * ` M src/foo.mts`   → `{ status: ' M', path: 'src/foo.mts' }`
 * `?? scripts/x.mts` → `{ status: '??', path: 'scripts/x.mts' }`
 * `R  old.mts -> new.mts` → `{ status: 'R ', path: 'new.mts' }`
 */
export function parsePorcelain(out: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = []
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const status = line.slice(0, 2)
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const filePath = arrow === -1 ? rest : rest.slice(arrow + 4)
    entries.push({ status, path: filePath })
  }
  return entries
}
