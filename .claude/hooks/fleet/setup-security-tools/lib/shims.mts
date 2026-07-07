import { existsSync } from 'node:fs'
import path from 'node:path'

import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'

// Single source for the SFW shim directory. The integrity checker
// (index.mts checkShims) and the repairers (index.mts repairShims,
// install.mts findBrokenShims) MUST scan the same dir — they previously
// diverged (`_wheelhouse/shims` vs a hardcoded `~/.socket/sfw/shims`), and the
// shared value itself then pointed at `_wheelhouse/shims`, a dir NO generator
// writes. The fleet generator (scripts/fleet/setup/setup-tools.mjs) writes
// shims into `_wheelhouse/bin` — the one PATH entry, where they co-live with
// the flat racked-tool handles (bin/sfw → rack/sfw/<ver>/sfw).
export function getShimsDir(): string {
  return path.join(getSocketAppDir('wheelhouse'), 'bin')
}

// The shim commands every provisioned machine gets — used as the "shims were
// wiped" tripwire. Deliberately the cross-platform core (the full ecosystem
// list varies by OS + enterprise flavor).
export const CORE_SHIM_COMMANDS = ['cargo', 'npm', 'pnpm', 'uv'] as const

/**
 * Extract the double-quoted absolute-path targets a shim executes and return
 * the ones that no longer exist on disk. Pure content scan, generator-agnostic:
 * matches the fleet shim shape (`"…/rack/sfw/<ver>/sfw" "…/real/tool" "$@"`),
 * the legacy sfw-native shape, and the older dlx-backed shape
 * (`"…/_dlx/<hash>/sfw-enterprise"`). `$`-containing tokens (`"$PATH"`, `"$@"`)
 * are shell variables, not paths, and are skipped.
 */
export function findBrokenShimTargets(content: string): string[] {
  const broken: string[] = []
  const quoted = content.matchAll(/"(?<target>\/[^"]+)"/g)
  for (const match of quoted) {
    const target = match.groups!['target']!
    if (target.includes('$')) {
      continue
    }
    if (!existsSync(target)) {
      broken.push(target)
    }
  }
  return broken
}

/**
 * Which of the core shim commands are missing from a shim dir. All-missing is
 * the "shims were wiped / never generated" repair trigger; partial absence is
 * left to the per-shim broken diagnostics.
 */
export function missingCoreShims(dir: string): string[] {
  return CORE_SHIM_COMMANDS.filter(cmd => !existsSync(path.join(dir, cmd)))
}
