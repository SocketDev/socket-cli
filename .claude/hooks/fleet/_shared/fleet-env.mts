#!/usr/bin/env node
/**
 * @file The universal fleet environment knobs — the fail-closed
 *   no-phone-home / no-telemetry posture set on EVERY platform and surface:
 *   dev shell-rc (setup-security-tools), CI (the reusable workflow `env:`), and
 *   spawned AI agents (`spawnAiAgent` child env). Single source of truth — the
 *   shell-rc bridge, the CI workflow env, and `telemetry-env-is-disabled.mts`
 *   all derive from THIS list so they can't diverge.
 *   Distinct from the macOS-only knobs (`HOMEBREW_*` in
 *   `package-manager-auto-update.mts` / `brew-supply-chain.mts`): those are
 *   platform-gated. These are cross-platform. `NO_UPDATE_NOTIFIER` lives here
 *   (not the macOS list) precisely because npm/pnpm honor it on every OS —
 *   scoping it to macOS is why CI runners never had it and the
 *   package-manager-auto-update gate failed in CI.
 *   Listed alphabetically by name (fleet `socket/sort-*` convention).
 */

export interface FleetEnvKnob {
  // The env-var name.
  readonly name: string
  // The value that enforces the fail-closed posture (always '1' today).
  readonly value: string
  // Why it's set + which tool honors it.
  readonly note: string
}

export const FLEET_ENV: readonly FleetEnvKnob[] = [
  {
    name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    value: '1',
    note:
      'Claude Code master no-phone-home switch (telemetry + error reporting ' +
      '+ autoupdater + non-essential model calls). Set for completeness even ' +
      'though Claude Code also honors DO_NOT_TRACK.',
  },
  {
    name: 'COREPACK_ENABLE_PROJECT_SPEC',
    value: '0',
    note:
      'Disable corepack — it is deprecated (removed from Node core) and the ' +
      'fleet never enables it. 0 makes corepack ignore package.json spec, so a ' +
      'stray shim cannot enforce a package manager; pnpm is declared via ' +
      'devEngines.packageManager and provisioned out-of-band (external-tools.json ' +
      'in CI, the racked installer locally).',
  },
  {
    name: 'DISABLE_TELEMETRY',
    value: '1',
    note: 'Generic telemetry opt-out honored by Claude Code and several CLIs.',
  },
  {
    name: 'DO_NOT_TRACK',
    value: '1',
    note:
      'Cross-tool opt-out standard (consoledonottrack.com); honored by ' +
      '@socketsecurity/lib prim (the vendored Claude Code runtime) and any ' +
      'future tool that reads it.',
  },
  {
    name: 'NO_UPDATE_NOTIFIER',
    value: '1',
    note:
      'Disables the npm + pnpm update-notifier registry phone-home. Universal ' +
      '(all platforms) — previously mis-scoped under the macOS-only list, ' +
      'which is why CI runners never received it.',
  },
]

/**
 * The `export NAME='value'` lines for a POSIX shell-rc, one per knob. The
 * shell-rc bridge embeds these in its managed block; kept here so the block
 * and the check derive from one list.
 */
export function fleetEnvShellExports(): readonly string[] {
  return FLEET_ENV.map(knob => `export ${knob.name}='${knob.value}'`)
}
