#!/usr/bin/env node
/*
 * @file Generate the AHEAD-OF-TIME TypeBox validators the fleet hook graph
 *   checks its data files with, and write them to
 *   `.claude/hooks/fleet/_shared/generated-validators.mts`.
 *
 *   `Code(schema)` from `typebox/compile` returns the validator as a standalone
 *   ESM module — `Compile()` is that same codegen plus an evaluation of the
 *   result. So the whole compiler can run at BUILD time: this maker emits the
 *   source, and the hook keeps only a plain function call.
 *
 *   Why it matters here specifically: a hook process is EPHEMERAL, one per tool
 *   event, so a validator compiled at startup amortizes its codegen over a
 *   single check and then the process exits. Doing it here moves that work to
 *   the build for BOTH runtime paths — the V8 snapshot and the plain
 *   `index.cjs` fallback — and drops TypeBox out of the bundled graph entirely.
 *
 *   Same channel as the dispatch table: generated, gitignored, never committed.
 *   Runs from the dispatch-table regen step in `gen/hook-dispatch.mts`,
 *   `build-hook-bundle.mts`, and `build-hook-snapshot.mts`, so every path that
 *   rebuilds the table refreshes the validators with it.
 *
 *   Usage: `node scripts/fleet/gen/hook-validators.mts`
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { Code } from 'typebox/compile'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { ToolsConfig } from '../lib/external-tools-schema.mts'
import { HOOK_VALIDATORS_PATH, REPO_ROOT } from '../paths.mts'
import { hasFleetHookSource } from '../_shared/fleet-source-present.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

import type { TSchema } from 'typebox'

const logger = getDefaultLogger()

/**
 * The line the emitted module exposes its entry point on: everything before it
 * is declarations (an `External` regex table plus one `const check_<n>` arrow
 * per subschema), and the line itself carries the call that runs them.
 * Splitting on it turns "a module to import" into "the inside of a function
 * declaration to emit".
 */
export const VALIDATOR_ENTRY_MARKER = 'export function Check(value) {'

/**
 * Namespaces `Code()`'s emitted module imports unconditionally, whether or not
 * the compiled body uses them. `Format` backs a schema's `format` keyword,
 * `Hashing` TypeBox's structural hash, `Guard` its runtime type guards. An AOT
 * emit drops the imports, so a body that actually CALLS into one of them would
 * throw `ReferenceError` on first use — generation fails loud instead.
 */
export const UNSUPPORTED_VALIDATOR_HELPERS: readonly string[] = [
  'Format.',
  'Guard.',
  'Hashing.',
]

/**
 * Which {@link UNSUPPORTED_VALIDATOR_HELPERS} a compiled body references. Empty
 * is the emittable case.
 */
export function findUnsupportedValidatorHelpers(code: string): string[] {
  const body = code
    .split('\n')
    .filter(line => !line.startsWith('import '))
    .join('\n')
  return UNSUPPORTED_VALIDATOR_HELPERS.filter(helper => body.includes(helper))
}

// The lambda parameters typebox generates inside a compiled body. It numbers
// them from a PROCESS-GLOBAL counter, so the same schema compiles to `var_0,
// var_1` on the first call and `var_14, var_15` on a later one.
const GENERATED_LOCAL_RE = /\bvar_\d+\b/g

/**
 * Renumber typebox's generated locals to a stable sequence, so compiling the
 * same schema always emits the same bytes.
 *
 * Without this the emitted file depends on how many schemas the process
 * happened to compile first — a generator run that follows a startup schema
 * check would write a different artifact than a clean run, and neither is
 * wrong, which is the worst kind of diff to chase.
 *
 * Assumes no string literal in a compiled body contains a `var_<digits>`
 * token. Fleet schemas name no property that way, and a collision would be
 * visible immediately as a broken validator rather than silent drift.
 */
export function renumberGeneratedLocals(source: string): string {
  const assigned = new Map<string, string>()
  return source.replace(GENERATED_LOCAL_RE, match => {
    let replacement = assigned.get(match)
    if (replacement === undefined) {
      replacement = `var_${assigned.size}`
      assigned.set(match, replacement)
    }
    return replacement
  })
}

/**
 * The exported function name for a schema: `ToolsConfig` → `checkToolsConfig`.
 */
export function validatorExportName(schemaName: string): string {
  return `check${schemaName}`
}

/**
 * Render the emitted module's `External` table as a source literal. `Code()`
 * hoists every regex out of the compiled body into live `RegExp` objects the
 * caller is expected to inject with `SetExternal()`; an emitted module has no
 * one to inject them, so they are written back in as regex literals under the
 * same name and indices the body already reads.
 */
export function renderExternalTable(
  schemaName: string,
  variables: readonly unknown[],
): string {
  const literals = variables.map((variable, index) => {
    if (!(variable instanceof RegExp)) {
      throw new Error(
        'gen/hook-validators: the compiled validator needs a non-regex external.\n' +
          `  Where: External[${index}] of the compiled source for ${schemaName}.\n` +
          `  Saw:   a ${typeof variable}, which has no source-literal form.\n` +
          '  Fix:   drop the schema feature that produced it, or teach this maker\n' +
          '         to serialize that external kind.',
      )
    }
    return String(variable)
  })
  return `  const External = [${literals.join(', ')}]`
}

/**
 * Wrap one `Code()` result as an exported function DECLARATION named after its
 * schema. The module's declarations become locals of that function and its
 * entry-point call becomes the body, so the emitted module has no imports, no
 * module-eval side effects, and no per-call re-entry cost.
 *
 * The `// @ts-ignore` lines are the compiler's own: each compiled arrow takes
 * an untyped `value`, and the comment is what lets the generated `.mts` still
 * type-check.
 */
export function wrapValidatorCode(
  schemaName: string,
  result: {
    readonly Code: string
    readonly External: { variables: unknown[] }
  },
): string {
  const { Code: code, External: external } = result
  const markerIdx = code.indexOf(VALIDATOR_ENTRY_MARKER)
  if (markerIdx === -1) {
    throw new Error(
      'gen/hook-validators: Code() output has no check-function entry line.\n' +
        `  Where: the compiled source for ${schemaName}.\n` +
        `  Saw:   no \`${VALIDATOR_ENTRY_MARKER}\` in the emitted module.\n` +
        '  Fix:   the pinned typebox changed its emit shape — update\n' +
        '         VALIDATOR_ENTRY_MARKER in scripts/fleet/gen/hook-validators.mts to match.',
    )
  }
  const unsupported = findUnsupportedValidatorHelpers(code)
  if (unsupported.length) {
    throw new Error(
      'gen/hook-validators: the schema compiles to a validator that needs TypeBox runtime helpers.\n' +
        `  Where: the compiled source for ${schemaName}.\n` +
        `  Saw:   references to ${unsupported.join(', ')}, which the emitted module imports from typebox and an AOT emit drops.\n` +
        '  Fix:   drop the custom format / hash-dependent type from the schema,\n' +
        '         or teach this maker to emit the runtime shims those references need.',
    )
  }
  // Everything before the entry line, minus what the standalone-module form
  // needs and a function body does not: the typebox imports, the mutable
  // `External` binding, and the `SetExternal` injector that fills it.
  const locals: string[] = []
  let pendingComment = ''
  const preambleLines = code.slice(0, markerIdx).split('\n')
  for (let i = 0, { length } = preambleLines; i < length; i += 1) {
    const line = preambleLines[i]!
    if (!line.trim()) {
      continue
    }
    if (line.startsWith('// ')) {
      pendingComment = line
      continue
    }
    if (
      line.startsWith('import ') ||
      line.startsWith('let External') ||
      line.startsWith('export function SetExternal')
    ) {
      pendingComment = ''
      continue
    }
    if (pendingComment) {
      locals.push(`  ${pendingComment}`)
      pendingComment = ''
    }
    locals.push(`  ${line}`)
  }
  locals.unshift(renderExternalTable(schemaName, external.variables))
  const tail = code.slice(markerIdx + VALIDATOR_ENTRY_MARKER.length)
  const body = tail.slice(0, tail.lastIndexOf('}')).trim()
  return renumberGeneratedLocals(
    `export function ${validatorExportName(schemaName)}(value: any): boolean {\n${locals.join('\n')}\n  ${body}\n}\n`,
  )
}

/**
 * One emitted validator: the schema, the name it is exported under, and the
 * source path a reader edits to change it.
 */
export interface HookValidatorSpec {
  readonly schema: TSchema
  readonly schemaName: string
  readonly source: string
}

/**
 * Every schema the hook graph validates against. `ToolsConfig` is the fleet's
 * one container shape for external-tools.json / bundle-tools.json, and
 * `setup-security-tools/lib/tool-config.mts` checks the security-hook copy of
 * that file against it on every load.
 */
export const HOOK_VALIDATOR_SPECS: readonly HookValidatorSpec[] = [
  {
    schema: ToolsConfig,
    schemaName: 'ToolsConfig',
    source: 'scripts/fleet/lib/external-tools-schema.mts',
  },
]

/**
 * Render the whole generated module: the banner, the file-scope lint waiver the
 * wrapped compiler output needs, then one exported validator per spec in schema
 * order so the output is byte-stable run to run.
 */
export function renderHookValidators(
  specs: readonly HookValidatorSpec[] = HOOK_VALIDATOR_SPECS,
): string {
  const ordered = [...specs].toSorted((a, b) =>
    a.schemaName < b.schemaName ? -1 : a.schemaName > b.schemaName ? 1 : 0,
  )
  const validators = ordered.map(
    spec =>
      `/**\n` +
      ` * Whether \`value\` satisfies the \`${spec.schemaName}\` schema\n` +
      ` * (${spec.source}).\n` +
      ` */\n` +
      wrapValidatorCode(spec.schemaName, Code(spec.schema)),
  )
  return (
    `// GENERATED by scripts/fleet/gen/hook-validators.mts — do not edit by hand.\n` +
    `// Ahead-of-time TypeBox validators: each body is Code() output, wrapped as an\n` +
    `// exported function declaration. Hook processes are one per tool event, so\n` +
    `// compiling a schema at startup would pay the compiler's codegen on every run\n` +
    `// and pull TypeBox into the runtime graph; emitting it here charges the build\n` +
    `// once instead. Re-run the maker after editing a source schema, then rebuild\n` +
    `// the bundle with scripts/fleet/build-hook-bundle.mts.\n` +
    `\n` +
    `/* oxlint-disable typescript/no-explicit-any -- the wrapped body is the TypeBox compiler's own output; it reads \`value\` at every depth, so \`any\` is the only parameter type that admits it. */\n` +
    `\n` +
    validators.join('\n')
  )
}

/**
 * Write the generated validators to `_shared/generated-validators.mts`, plus
 * the `template/base/` mirror so the wheelhouse's own CI readers and the
 * release-bundle walk find them (both copies are gitignored, so a fresh
 * checkout has neither). No-op on a bundle-only member: there is no hook source
 * to validate for, and the release bundle ships the artifact.
 */
export function writeHookValidators(): void {
  if (!hasFleetHookSource(REPO_ROOT)) {
    return
  }
  const source = renderHookValidators()
  // The output lives inside the cascade-locked hook mirror; the shared helper
  // lifts the read-only lock around the write.
  writeThroughMirrorLock(HOOK_VALIDATORS_PATH, source)
  // Dogfood: the wheelhouse carries a template/base/ tree a member does not.
  const templateDir = path.join(
    REPO_ROOT,
    'template/base/.claude/hooks/fleet/_shared',
  )
  if (existsSync(templateDir)) {
    writeThroughMirrorLock(
      path.join(templateDir, path.basename(HOOK_VALIDATORS_PATH)),
      source,
    )
  }
}

function main(): void {
  if (!hasFleetHookSource(REPO_ROOT)) {
    logger.log(
      '[gen/hook-validators] no fleet hook source (bundle-only) — validators ship via the release bundle.',
    )
    return
  }
  writeHookValidators()
  const { length } = HOOK_VALIDATOR_SPECS
  logger.log(
    `Wrote ${path.relative(REPO_ROOT, HOOK_VALIDATORS_PATH)}: ` +
      `${length} ahead-of-time validator${length === 1 ? '' : 's'}.`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'generates the ahead-of-time TypeBox validators the fleet hook graph checks its data files with',
  help: 'Usage: node scripts/fleet/gen/hook-validators.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
