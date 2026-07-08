/*
 * @file The named fleet-sync target registry. `git is more powerful than
 *   "pnpm-workspace.yaml only cascaded"` — this table lets an operator call out
 *   a NAMED thing (`pnpm-workspace`, `lint-config`, `foundationals`, …) and sync
 *   exactly that slice of the cascade at one of three scopes (dogfood / fleet /
 *   one repo). The dispatcher (`scripts/fleet/sync.mts`) resolves a target name
 *   to its finding-category set, runs the cascade engine's checks, filters the
 *   findings to that set, and fixes only those.
 *
 *   Each non-composite target lists the cascade `category` strings it owns —
 *   the same strings the sync-scaffolding checks push (see
 *   `scripts/repo/sync-scaffolding/types.mts` `CATEGORY`). A composite target
 *   lists other target names in `composite[]` instead; the dispatcher expands
 *   them recursively and de-duplicates the union of categories.
 *
 *   FLEET-CANONICAL (cascaded under `scripts/fleet/`): a member repo runs the
 *   same dispatcher, so the registry must NOT import the wheelhouse-only
 *   `scripts/repo/sync-scaffolding/` tree (it doesn't exist in a member). The
 *   category union is therefore re-stated here as `KNOWN_CATEGORIES`; the
 *   wheelhouse's own test cross-checks it against the live `CATEGORY` const so
 *   the two can't silently drift.
 */

export type SyncScope = 'dogfood' | 'fleet' | 'repo'

export interface SyncTarget {
  readonly description: string
  readonly scopes: readonly SyncScope[]
  // The cascade finding categories this target owns. Empty for composites
  // (they delegate to `composite[]`); empty for a leaf with no category yet
  // (e.g. editor-config carries no dedicated category — it rides the
  // byte-identical content_drift / missing_required set, listed explicitly).
  readonly categories: readonly string[]
  // Other target names this composite expands into. Mutually exclusive with a
  // non-empty `categories` in practice, but both are allowed: a composite may
  // also pin a category of its own.
  readonly composite?: readonly string[] | undefined
  // Optional path-glob allowlist scoping which FILES this target owns. Required
  // for any leaf that rides a GENERIC category (`content_drift`,
  // `missing_required`, …) shared by the whole byte-identical mirror: without
  // it, the dispatcher's category filter would match every drifted file
  // repo-wide, so `foundationals` (via editor-config / lint-config) would pull
  // in `.git-hooks`, workflows, docker-prebakes, … A finding matches this
  // target only when its category is owned AND its `file` matches a glob here.
  // Patterns support `*` (one path segment) and `**` (any, incl. `/`); a `**/`
  // prefix also matches zero leading segments (so `**/tsconfig.json` matches a
  // repo-root `tsconfig.json`). Omit to own every file in the categories (the
  // right default for file-specific categories and for the full-payload
  // `fleet-code` target).
  readonly paths?: readonly string[] | undefined
}

// Every cascade finding category the dispatcher may filter on. Mirrors the
// sync-scaffolding `CATEGORY` const (the single source of truth in the
// wheelhouse); kept as a flat set here because a member repo has no access to
// that wheelhouse-only module. A `package_baseline_drift` entry is included for
// the package-baseline target's new check. Sorted (socket/sort).
export const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  'agents_mirror_regen',
  'agents_mirror_tracked',
  'allow_scripts_drift',
  'catalog_drift',
  'catalog_retired',
  'claude_md_fleet_block_size_warn',
  'claude_md_fleet_drift',
  'claude_md_fleet_missing',
  'conditional_drift',
  'conditional_missing',
  'config_invalid',
  'content_drift',
  'engines_npm_drift',
  'engines_pnpm_drift',
  'external_sources_uninit',
  'fleet_dir_drift',
  'fleet_mirror_orphan',
  'forbidden_command',
  'gitattributes_fleet_drift',
  'gitattributes_fleet_missing',
  'gitignore_fleet_drift',
  'gitignore_fleet_missing',
  'gitmodules_missing_ignore_dirty',
  'gitmodules_missing_pin_comment',
  'lib_drift',
  'lint_profile',
  'lockfile_workspace_missing',
  'manifest_stale',
  'missing_canonical_devdep',
  'missing_expected',
  'missing_hook_target',
  'missing_recommended_script',
  'missing_required',
  'missing_script',
  'native_should_not_ship',
  'native_should_ship',
  'node_version_drift',
  'node_version_missing',
  'nonstandard_prepare',
  'npm_run_all2_node_run_missing',
  'optional_dir_drift',
  'optional_drift',
  'oxfmt_fleet_ignore_drift',
  'oxfmt_fleet_ignore_missing',
  'oxfmt_jsdoc_drift',
  'oxfmt_jsdoc_missing',
  'oxlint_fleet_ignore_drift',
  'oxlint_fleet_ignore_missing',
  'oxlint_rule_activation_level_drift',
  'oxlint_rule_activation_missing',
  'oxlint_rule_override_drift',
  'oxlint_rule_override_missing',
  'oxlint_rule_wiring_drift',
  'package_baseline_drift',
  'package_files_forbidden',
  'package_files_missing',
  'package_files_missing_required',
  'package_files_required_missing_on_disk',
  'package_manager_drift',
  'parse_error',
  'preset_missing',
  'readme_skeleton_missing_section',
  'readme_skeleton_missing_social_badges',
  'readme_skeleton_relative_sibling',
  'readme_skeleton_wheelhouse_leak',
  'script_body_drift',
  'script_smoke_failure',
  'settings_merge_drift',
  'settings_repo_hook_missing',
  'thin_wiring_missing',
  'tombstone_orphan',
  'tsconfig_base_missing',
  'tsconfig_concrete_in_config',
  'tsconfig_concrete_missing_at_root',
  'tsconfig_extends_wrong_path',
  'unpinned_workflow',
  'uses_comment_drift',
  'workflow_flat_action_ref',
  'workflow_fleet_drift',
  'workflow_fleet_missing',
  'workflow_npm_install',
  'workspace_exclude',
  'workspace_exclude_expired',
  'workspace_exclude_glob',
  'workspace_setting',
  'workspace_trust_exclude',
])

// All three scopes — the default `scopes` for a leaf target that's syncable at
// every scope. Named once so the table reads cleanly.
const ALL_SCOPES: readonly SyncScope[] = ['dogfood', 'fleet', 'repo']

/**
 * The named-sync target registry. Keys are the vocabulary an operator calls out
 * ("cascade pnpm-workspace", "dogfood foundationals", "cascade
 * lint-config to socket-registry"). Sorted by key (socket/sort) except
 * the composites, which sort after the leaves for readability (a composite
 * references leaves, so grouping it last keeps the dependency direction
 * obvious).
 */
// socket-lint: allow object-property-order -- leaves are key-sorted but the
// composites (all/dogfood/foundationals) intentionally sort AFTER the leaves
// they reference, so the dependency direction reads top-to-bottom (see above).
export const SYNC_TARGETS: Readonly<Record<string, SyncTarget>> = {
  __proto__: null,
  // --- Leaf targets (own a concrete category set) ---
  'claude-md': {
    description: 'CLAUDE.md fleet-canonical block (BEGIN/END markers).',
    scopes: ALL_SCOPES,
    categories: [
      'claude_md_fleet_block_size_warn',
      'claude_md_fleet_drift',
      'claude_md_fleet_missing',
    ],
  },
  'editor-config': {
    description:
      '.editorconfig + .npmrc + tsconfig base/check — byte-identical editor ' +
      'and TypeScript config. Rides the content-drift mirror (no dedicated ' +
      'category), plus the tsconfig-shape categories.',
    scopes: ALL_SCOPES,
    categories: [
      'content_drift',
      'missing_required',
      'tsconfig_base_missing',
      'tsconfig_concrete_in_config',
      'tsconfig_concrete_missing_at_root',
      'tsconfig_extends_wrong_path',
    ],
    paths: [
      '.editorconfig',
      '.npmrc',
      '**/tsconfig.*.json',
      '**/tsconfig.json',
    ],
  },
  'fleet-code': {
    description:
      'The directory-mirror payload (.claude/{hooks,skills,commands,agents}/' +
      'fleet, docs/agents.md/fleet, .config/fleet/*, scripts/fleet, .git-hooks) ' +
      '— delete-and-replace tree sync. Intentionally UNSCOPED (no `paths`): it ' +
      'is the full-payload catch-all that makes `all` cover every drifted file. ' +
      'Do not add a `paths` allowlist here — narrow targets get one, this one ' +
      'owns the rest.',
    scopes: ALL_SCOPES,
    categories: [
      'content_drift',
      'fleet_dir_drift',
      'fleet_mirror_orphan',
      'missing_required',
      'tombstone_orphan',
      'workflow_flat_action_ref',
    ],
  },
  'git-meta': {
    description: '.gitignore + .gitattributes fleet-canonical blocks.',
    scopes: ALL_SCOPES,
    categories: [
      'gitattributes_fleet_drift',
      'gitattributes_fleet_missing',
      'gitignore_fleet_drift',
      'gitignore_fleet_missing',
    ],
  },
  installer: {
    description:
      'The dep-0 bootstrap installer (bootstrap/fleet.mjs) — cascaded the old ' +
      'way (manual safe-copy + commit), never shipped in the release bundle.',
    scopes: ALL_SCOPES,
    categories: ['content_drift', 'fleet_dir_drift', 'missing_required'],
    paths: ['bootstrap/fleet.mjs'],
  },
  'lint-config': {
    description:
      'oxlint + oxfmt config (.config/fleet/{oxlintrc.json,oxlint.config.mts,' +
      'oxfmtrc.json,.prettierignore,.markdownlint-cli2.jsonc}) + the canonical ' +
      'socket/* rule activations and fleet-ignore blocks.',
    scopes: ALL_SCOPES,
    categories: [
      'content_drift',
      'lint_profile',
      'missing_required',
      'oxfmt_fleet_ignore_drift',
      'oxfmt_fleet_ignore_missing',
      'oxlint_fleet_ignore_drift',
      'oxlint_fleet_ignore_missing',
      'oxlint_rule_activation_level_drift',
      'oxlint_rule_activation_missing',
      'oxlint_rule_override_drift',
      'oxlint_rule_override_missing',
      'oxlint_rule_wiring_drift',
    ],
    paths: [
      '.config/fleet/.markdownlint-cli2.jsonc',
      '.config/fleet/.prettierignore',
      '.config/fleet/markdownlint-rules/**',
      '.config/fleet/oxfmtrc.json',
      '.config/fleet/oxlint-plugin/**',
      '.config/fleet/oxlint.config.mts',
      '.config/fleet/oxlintrc.json',
    ],
  },
  'package-baseline': {
    description:
      'package.json fleet-owned scripts + catalog: devDependencies — ' +
      'deep-merged, preserving every repo-owned key.',
    scopes: ALL_SCOPES,
    categories: ['package_baseline_drift'],
  },
  'package-manager': {
    description:
      'package.json `packageManager` (forgiving `pnpm@>=<floor>`) + the ' +
      '`engines.pnpm` floor, derived from the wheelhouse root pins. The two ' +
      'cascade-fixable package-manager pins; engines.node stays repo-owned.',
    scopes: ALL_SCOPES,
    categories: ['engines_pnpm_drift', 'package_manager_drift'],
  },
  'pnpm-workspace': {
    description:
      'pnpm-workspace.yaml fleet sections (settings / catalog / overrides / ' +
      'soak-excludes); the `packages:` block is preserved.',
    scopes: ALL_SCOPES,
    categories: [
      'catalog_drift',
      'catalog_retired',
      'workspace_exclude',
      'workspace_exclude_expired',
      'workspace_exclude_glob',
      'workspace_setting',
      'workspace_trust_exclude',
    ],
  },
  presets: {
    description:
      'Seed-once starters (template/presets/) — github-release.yml + ' +
      'npm-publish.yml workflow defaults, copied only where absent; an ' +
      'existing target is repo-owned and never touched.',
    scopes: ALL_SCOPES,
    categories: ['preset_missing'],
  },
  // --- Composite targets (expand into other targets) ---
  all: {
    description:
      'The full cascade — every named target. Equivalent to the unfiltered ' +
      'sync-scaffolding run.',
    scopes: ALL_SCOPES,
    categories: [],
    composite: [
      'claude-md',
      'editor-config',
      'fleet-code',
      'git-meta',
      'installer',
      'lint-config',
      'package-baseline',
      'package-manager',
      'pnpm-workspace',
      'presets',
    ],
  },
  dogfood: {
    description:
      'The wheelhouse self-sync set: the installer plus the foundationals, ' +
      'template/base → live.',
    scopes: ['dogfood'],
    categories: [],
    composite: ['foundationals', 'installer'],
  },
  foundationals: {
    description:
      'The fleet-wide base every member shares: workspace + package baseline + ' +
      'lint + editor config + CLAUDE.md + git metadata.',
    scopes: ALL_SCOPES,
    categories: [],
    composite: [
      'claude-md',
      'editor-config',
      'git-meta',
      'lint-config',
      'package-baseline',
      'package-manager',
      'pnpm-workspace',
    ],
  },
} as unknown as Readonly<Record<string, SyncTarget>>

/**
 * Resolve a target name to its full set of cascade finding categories,
 * expanding composites recursively and de-duplicating the union. Throws on an
 * unknown name (the caller surfaces it as a usage error). The `seen` set guards
 * against a malformed composite cycle so a self-referential entry can't recurse
 * forever.
 */
export function resolveTargetCategories(
  name: string,
  seen: Set<string> = new Set(),
): Set<string> {
  if (seen.has(name)) {
    return new Set()
  }
  seen.add(name)
  const target = SYNC_TARGETS[name]
  if (target === undefined) {
    throw new Error(
      `Unknown sync target "${name}". Known targets: ${Object.keys(SYNC_TARGETS)
        .filter(k => k !== '__proto__')
        .toSorted()
        .join(', ')}.`,
    )
  }
  const out = new Set<string>(target.categories)
  for (const sub of target.composite ?? []) {
    for (const cat of resolveTargetCategories(sub, seen)) {
      out.add(cat)
    }
  }
  return out
}

/**
 * Resolve a target name to the set of LEAF target names it covers — every
 * reachable target that owns categories (a leaf), expanding composites
 * recursively. The dispatcher needs the leaves (not just the merged category
 * union) so it can keep each leaf's `paths` scope paired with its categories: a
 * finding matches the sync only when SOME leaf owns its category AND (that leaf
 * declares no `paths` OR the finding's file matches one of them). Merging into
 * a flat category set would drop the per-leaf path association and re-introduce
 * the over-scope bug. The `seen` set guards against a malformed composite
 * cycle.
 */
export function resolveTargetLeaves(
  name: string,
  seen: Set<string> = new Set(),
): Set<string> {
  if (seen.has(name)) {
    return new Set()
  }
  seen.add(name)
  const target = SYNC_TARGETS[name]
  if (target === undefined) {
    throw new Error(
      `Unknown sync target "${name}". Known targets: ${Object.keys(SYNC_TARGETS)
        .filter(k => k !== '__proto__')
        .toSorted()
        .join(', ')}.`,
    )
  }
  const out = new Set<string>()
  if (target.categories.length > 0) {
    out.add(name)
  }
  for (const sub of target.composite ?? []) {
    for (const leaf of resolveTargetLeaves(sub, seen)) {
      out.add(leaf)
    }
  }
  return out
}

/**
 * Load-time invariant: every non-composite target must list at least one
 * category (an empty leaf is a registry bug — it would silently fix nothing),
 * and every category it lists must be a known cascade category (a typo'd
 * category never matches a finding, so the target would silently no-op). A
 * composite is exempt from the non-empty rule (it delegates) and every name it
 * references must exist. Throws on the first violation so a broken registry
 * fails fast at import.
 */
function assertRegistryIsValid(): void {
  const names = Object.keys(SYNC_TARGETS).filter(k => k !== '__proto__')
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    const target = SYNC_TARGETS[name]!
    const isComposite = (target.composite?.length ?? 0) > 0
    if (!isComposite && target.categories.length === 0) {
      throw new Error(
        `[sync-targets] target "${name}" is a non-composite with no ` +
          'categories — it would resolve to an empty filter and fix nothing.',
      )
    }
    for (let j = 0, clen = target.categories.length; j < clen; j += 1) {
      const cat = target.categories[j]!
      if (!KNOWN_CATEGORIES.has(cat)) {
        throw new Error(
          `[sync-targets] target "${name}" lists unknown category "${cat}". ` +
            'A category not in KNOWN_CATEGORIES never matches a finding, so ' +
            'the target would silently no-op. Fix the category string (it must ' +
            'match a sync-scaffolding CATEGORY value).',
        )
      }
    }
    for (const sub of target.composite ?? []) {
      if (SYNC_TARGETS[sub] === undefined) {
        throw new Error(
          `[sync-targets] composite "${name}" references unknown target ` +
            `"${sub}".`,
        )
      }
    }
    if (target.paths !== undefined) {
      if (target.paths.length === 0) {
        throw new Error(
          `[sync-targets] target "${name}" declares an empty paths[] — ` +
            'an empty allowlist matches no file, so the target would silently ' +
            'fix nothing. Omit `paths` to own every file in the categories.',
        )
      }
      for (let j = 0, plen = target.paths.length; j < plen; j += 1) {
        if (typeof target.paths[j] !== 'string' || target.paths[j] === '') {
          throw new Error(
            `[sync-targets] target "${name}" has a non-string/empty path ` +
              `glob at index ${j}.`,
          )
        }
      }
    }
  }
}

assertRegistryIsValid()
