// Shared exemption for forbidden-LITERAL scans. A CHANGELOG is change-
// description prose that legitimately NAMES an identifier a change affected (an
// egress host, a kill-switch, a marker), and it is never loaded as active
// config — so the literal there can't cause the harm the scan guards against.
// Full-tree "no tracked file may carry <literal>" checks
// (taze-is-single-registry's forbidden host, etc.) exempt it so a truthful
// changelog entry doesn't red the gate.
//
// Scope: only literals that are legitimate to NAME in a changelog. Secrets and
// real private paths are illegitimate ANYWHERE and stay blocked in a changelog.

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * True when `file` is a CHANGELOG (root or nested), matched by basename so any
 * dir depth counts. Case-insensitive on the stem; accepts `.md`/`.markdown` or
 * no extension (the fleet uses `CHANGELOG.md`).
 */
export function isChangelogPath(file: string): boolean {
  const base = path.basename(normalizePath(file))
  // `changelog` stem (case-insensitive), optionally `.markdown` / `.md`, and
  // nothing after — so `CHANGELOG.md.bak` / `changelog-writer.mts` don't match.
  return /^changelog(?:\.(?:markdown|md))?$/i.test(base)
}
