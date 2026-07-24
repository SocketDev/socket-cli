/**
 * Fleet skill taxonomy and the canonical cross-skill routing graph.
 */

export const SKILL_FAMILIES = [
  'orient',
  'plan',
  'build',
  'review',
  'security',
  'ship',
  'fleet',
  'maintain',
  'design',
] as const

export type SkillFamily = (typeof SKILL_FAMILIES)[number]
export type SkillMode = 'read-only' | 'mutating' | 'mixed'

export interface SkillDefinition {
  family: SkillFamily
  mode: SkillMode
}

/**
 * Every fleet skill is classified exactly once.
 */
export const FLEET_SKILL_CATALOG: Readonly<Record<string, SkillDefinition>> = {
  'agent-ci': { family: 'ship', mode: 'mixed' },
  'auditing-api-surface': { family: 'review', mode: 'read-only' },
  'auditing-gha': { family: 'security', mode: 'read-only' },
  'authoring-spec': { family: 'plan', mode: 'mutating' },
  'building-tdd': { family: 'build', mode: 'mutating' },
  'cascading-fleet': { family: 'fleet', mode: 'mutating' },
  'cleaning-ci': { family: 'maintain', mode: 'mutating' },
  'codifying-disciplines': { family: 'fleet', mode: 'mixed' },
  'consolidating-commits': { family: 'ship', mode: 'mutating' },
  'creating-guards': { family: 'build', mode: 'mutating' },
  'decomposing-tickets': { family: 'plan', mode: 'mutating' },
  'deduping-dependencies': { family: 'maintain', mode: 'mutating' },
  'delegating-execution': { family: 'plan', mode: 'mutating' },
  'designing-interfaces': { family: 'design', mode: 'mixed' },
  'diagnosing-bugs': { family: 'build', mode: 'read-only' },
  'driving-cursor-bugbot': { family: 'review', mode: 'mutating' },
  'extracting-design-systems': { family: 'design', mode: 'mutating' },
  'greening-ci': { family: 'ship', mode: 'mutating' },
  'greening-ci-local': { family: 'ship', mode: 'mutating' },
  'grilling-plan': { family: 'plan', mode: 'read-only' },
  'grooming-backlog': { family: 'plan', mode: 'mutating' },
  'guarding-paths': { family: 'build', mode: 'mutating' },
  'handing-off': { family: 'orient', mode: 'mutating' },
  improve: { family: 'plan', mode: 'read-only' },
  'improving-web-interfaces': { family: 'design', mode: 'mutating' },
  'locking-down-claude': { family: 'security', mode: 'mutating' },
  'looping-quality': { family: 'review', mode: 'mutating' },
  'managing-pnpm-workspaces': { family: 'maintain', mode: 'mutating' },
  'managing-worktrees': { family: 'fleet', mode: 'mutating' },
  map: { family: 'orient', mode: 'read-only' },
  'migrating-rule-packs': { family: 'build', mode: 'mutating' },
  'onboarding-fleet-member': { family: 'fleet', mode: 'mutating' },
  'opening-pr': { family: 'ship', mode: 'mutating' },
  'optimizing-compiler-performance': { family: 'build', mode: 'mutating' },
  'optimizing-cpp-performance': { family: 'build', mode: 'mutating' },
  'optimizing-go-performance': { family: 'build', mode: 'mutating' },
  'optimizing-javascript-performance': { family: 'build', mode: 'mutating' },
  'optimizing-memory-performance': { family: 'build', mode: 'mutating' },
  'optimizing-node-native-performance': { family: 'build', mode: 'mutating' },
  'optimizing-parser-performance': { family: 'build', mode: 'mutating' },
  'optimizing-performance': { family: 'build', mode: 'mutating' },
  'optimizing-react-interfaces': { family: 'design', mode: 'mutating' },
  'optimizing-rust-performance': { family: 'build', mode: 'mutating' },
  'optimizing-submodules': { family: 'maintain', mode: 'mutating' },
  'optimizing-webassembly-performance': { family: 'build', mode: 'mutating' },
  'patching-findings': { family: 'security', mode: 'mutating' },
  'plugging-promise-race': { family: 'build', mode: 'mutating' },
  'property-and-fuzz-testing': { family: 'build', mode: 'mutating' },
  prose: { family: 'orient', mode: 'mutating' },
  pushing: { family: 'ship', mode: 'mutating' },
  'refreshing-history': { family: 'fleet', mode: 'mutating' },
  'releasing-a-package': { family: 'ship', mode: 'mutating' },
  'rendering-chromium-to-png': { family: 'design', mode: 'read-only' },
  'reordering-release-bump': { family: 'ship', mode: 'mutating' },
  'researching-recency': { family: 'orient', mode: 'read-only' },
  'reviewing-code': { family: 'review', mode: 'read-only' },
  'reviewing-web-interfaces': { family: 'design', mode: 'read-only' },
  'running-test262': { family: 'review', mode: 'read-only' },
  'scanning-quality': { family: 'review', mode: 'mixed' },
  'scanning-security': { family: 'security', mode: 'read-only' },
  'scanning-vulns': { family: 'security', mode: 'read-only' },
  'setup-repo': { family: 'orient', mode: 'mutating' },
  'squashing-history': { family: 'fleet', mode: 'mutating' },
  'testing-web-interfaces': { family: 'design', mode: 'read-only' },
  'threat-modeling': { family: 'security', mode: 'mixed' },
  'tidying-files': { family: 'maintain', mode: 'mutating' },
  'tidying-rolldown-bundles': { family: 'maintain', mode: 'mutating' },
  'tidying-worktrees': { family: 'fleet', mode: 'mutating' },
  'triaging-findings': { family: 'security', mode: 'read-only' },
  'trimming-bundle': { family: 'maintain', mode: 'mutating' },
  updating: { family: 'maintain', mode: 'mutating' },
  'updating-coverage': { family: 'maintain', mode: 'mutating' },
  'updating-daily': { family: 'maintain', mode: 'mutating' },
  'updating-hooks-dry': { family: 'maintain', mode: 'read-only' },
  'updating-lockstep': { family: 'maintain', mode: 'mutating' },
  'updating-pricing': { family: 'maintain', mode: 'mutating' },
  'updating-security': { family: 'security', mode: 'mutating' },
}

/**
 * Cross-family routes that must remain visible as direct SKILL.md links.
 */
/**
 * Fleet skills that operate ON the wheelhouse (not on a member's own code) and
 * reference wheelhouse-only machinery such as `scripts/repo/*`. They live in
 * the wheelhouse's own `.claude/skills/fleet/` but are intentionally omitted
 * from member repos by the cascade. The skill-system coherence check honors
 * this list so members don't fail for a skill they are not supposed to carry.
 */
export const WHEELHOUSE_ONLY_SKILLS: readonly string[] = [
  'onboarding-fleet-member',
]

export const SKILL_HANDOFFS: Readonly<Record<string, readonly string[]>> = {
  'agent-ci': ['greening-ci-local', 'greening-ci'],
  'authoring-spec': ['grilling-plan', 'decomposing-tickets', 'building-tdd'],
  'building-tdd': ['reviewing-code', 'pushing'],
  'cascading-fleet': ['syncing-fleet'],
  'decomposing-tickets': ['opening-pr'],
  'opening-pr': ['pushing', 'prose'],
  'patching-findings': ['pushing'],
  pushing: ['greening-ci', 'agent-ci'],
  'scanning-quality': ['looping-quality', 'patching-findings'],
  'scanning-vulns': ['triaging-findings'],
  'triaging-findings': ['patching-findings'],
  updating: ['cascading-fleet', 'updating-security'],
}
