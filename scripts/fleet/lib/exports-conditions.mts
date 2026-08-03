/**
 * @file Condition policy for package.json `exports` maps, shared by the
 *   generator — `scripts/fleet/gen/package-exports.mts` resolves each runtime
 *   entry's `source` twin and declaration twin into `source`/`types`
 *   conditions — and the validator —
 *   `scripts/fleet/check/public-files-are-exported.mts` fails the gate when a
 *   runtime export ships without a resolvable `types` condition ordered ahead
 *   of its runtime conditions. TypeScript's nodenext resolution matches export
 *   conditions in declaration ORDER, so `types` must precede
 *   `default`/`import`/`require`/`node`; a missing or trailing `types` ships
 *   an untyped package and consumers get TS7016. Incident this module guards:
 *   packageurl-js 1.4.5 regenerated exports through an ignore glob that
 *   swallowed `dist/{index,exists}.d.mts` and shipped `source` + `default`
 *   only.
 */

import path from 'node:path'

// Condition names that hand a resolver runtime JS. A conditions object whose
// own keys include one of these with a runtime target is a runtime entry and
// must carry a `types` condition AHEAD of them — TypeScript matches export
// conditions in declaration order, so a trailing `types` never wins.
const RUNTIME_CONDITION_NAMES = new Set([
  'browser',
  'default',
  'import',
  'module-sync',
  'node',
  'require',
])

// A target that resolves runtime JavaScript.
export const RUNTIME_TARGET_RE = /\.[cm]?js$/

// A target TypeScript accepts as a declaration file.
export const DTS_TARGET_RE = /\.d\.[cm]?ts$/

// Detect the full compound declaration extension so twin resolution strips
// `.d.ts` / `.d.mts` / `.d.cts` correctly. Mirrors detectExt in the generator
// without importing it — this module stays dependency-free of the generator.
function fileExt(p: string): string {
  const dts = DTS_TARGET_RE.exec(p)
  return dts ? dts[0] : path.extname(p)
}

// Resolve a `src/<path>.{ts,mts,cts}` twin for the dev `source` condition.
// Only when the file is a dist build artifact with a real source behind it.
export function resolveSourcePath(
  rel: string,
  outDir: string,
  srcFiles: ReadonlySet<string>,
): string | undefined {
  if (!outDir || !rel.startsWith(`${outDir}/`)) {
    return undefined
  }
  const ext = fileExt(rel)
  const distRel = rel.slice(outDir.length + 1).slice(0, -ext.length)
  for (const candidate of [
    `${distRel}.ts`,
    `${distRel}.mts`,
    `${distRel}.cts`,
  ]) {
    if (srcFiles.has(candidate)) {
      return `./src/${candidate}`
    }
  }
  return undefined
}

/**
 * Normalize the `exports` field into subpath entries. Handles the sugar forms:
 * a bare string and a bare conditions object both describe the `.` entry.
 */
export function exportEntriesOf(
  exportsValue: unknown,
): Array<[string, unknown]> {
  if (typeof exportsValue === 'string') {
    return [['.', exportsValue]]
  }
  if (!exportsValue || typeof exportsValue !== 'object') {
    return []
  }
  const record = exportsValue as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.some(k => k.startsWith('.'))) {
    return Object.entries(record)
  }
  return keys.length ? [['.', record]] : []
}

export interface TypesProblem {
  readonly detail: string
}

/**
 * Validate one export entry's `types` coverage. Returns problems — empty means
 * typed, or not a runtime entry at all. Pure over the entry value so it is
 * testable without a package on disk; the caller handles target resolvability.
 *
 * Rules, applied to every conditions level of the entry:
 * - a level exposing a runtime target must see a `types` condition, either on
 * the SAME level ordered before the runtime condition or inherited from an
 * ancestor level that ordered `types` before the branch taken;
 * - a `types` value must look like a declaration file.
 */
export function collectTypesProblems(
  entryPath: string,
  value: unknown,
): TypesProblem[] {
  const problems: TypesProblem[] = []
  if (typeof value === 'string') {
    if (RUNTIME_TARGET_RE.test(value)) {
      problems.push({
        detail: `exports["${entryPath}"] resolves runtime code ("${value}") with no "types" condition — TypeScript consumers under nodenext get TS7016, an untyped import.`,
      })
    }
    return problems
  }
  if (!value || typeof value !== 'object') {
    return problems
  }
  walkConditions(entryPath, value as Record<string, unknown>, {
    inheritedTypes: false,
    problems,
  })
  return problems
}

interface WalkConditionsState {
  // A `types` condition on an ancestor level precedes the branch taken.
  readonly inheritedTypes: boolean
  readonly problems: TypesProblem[]
}

function walkConditions(
  entryPath: string,
  conditions: Record<string, unknown>,
  state: WalkConditionsState,
): void {
  const { inheritedTypes, problems } = state
  const keys = Object.keys(conditions)
  const typesIdx = keys.indexOf('types')
  const typesValue = conditions['types']
  if (
    typesIdx !== -1 &&
    typeof typesValue === 'string' &&
    !DTS_TARGET_RE.test(typesValue)
  ) {
    problems.push({
      detail: `exports["${entryPath}"] "types" condition targets "${typesValue}", which is not a declaration file — expected *.d.ts / *.d.mts / *.d.cts.`,
    })
  }
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const conditionValue = conditions[key]
    const typedHere =
      inheritedTypes ||
      (typesIdx !== -1 && typesIdx < i && typeof typesValue === 'string')
    if (
      typeof conditionValue === 'string' &&
      RUNTIME_CONDITION_NAMES.has(key) &&
      RUNTIME_TARGET_RE.test(conditionValue)
    ) {
      if (typedHere) {
        continue
      }
      problems.push({
        detail:
          typesIdx === -1
            ? `exports["${entryPath}"] resolves runtime code via "${key}" with no "types" condition — TypeScript consumers under nodenext get TS7016, an untyped import.`
            : `exports["${entryPath}"] orders "types" AFTER "${key}" — conditions match in declaration order, so TypeScript never reaches it. Move "types" before every runtime condition.`,
      })
      // One shape problem per conditions level is enough signal.
      return
    }
    if (conditionValue && typeof conditionValue === 'object') {
      walkConditions(entryPath, conditionValue as Record<string, unknown>, {
        inheritedTypes: typedHere,
        problems,
      })
    }
  }
}

/**
 * Collect every `types` target reachable from an export entry value — top
 * level and nested condition objects — so a caller can verify resolvability.
 */
export function collectTypesTargets(
  value: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  if (!value || typeof value !== 'object') {
    return out
  }
  const record = value as Record<string, unknown>
  for (const { 0: key, 1: conditionValue } of Object.entries(record)) {
    if (key === 'types' && typeof conditionValue === 'string') {
      out.add(conditionValue)
    } else if (conditionValue && typeof conditionValue === 'object') {
      collectTypesTargets(conditionValue, out)
    }
  }
  return out
}

/**
 * Resolve the declaration twin — `foo.d.mts` beside `foo.js` — for a runtime
 * entry's `types` condition. Looked up in the FULL declaration list, globbed
 * without the config `ignore` globs, so a config that keeps per-module
 * declarations from becoming their own export entries still yields typed
 * entry points. `rel` and `declFiles` are package-root-relative unix-slash
 * paths.
 */
export function resolveTypesPath(
  rel: string,
  declFiles: ReadonlySet<string>,
): string | undefined {
  if (DTS_TARGET_RE.test(rel) || rel.endsWith('.json')) {
    return undefined
  }
  const extMatch = RUNTIME_TARGET_RE.exec(rel)
  if (!extMatch) {
    return undefined
  }
  const base = rel.slice(0, -extMatch[0].length)
  for (const candidate of [`${base}.d.ts`, `${base}.d.mts`, `${base}.d.cts`]) {
    if (declFiles.has(candidate)) {
      return `./${candidate}`
    }
  }
  return undefined
}
