/**
 * @file Prove stage-zero bytes from signed producer trees or ordered template
 *   patches.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { selectCanonicalPatch } from './patch.mts'
import { applyCanonicalReplacements } from './replacements.mts'
import path from 'node:path'
import {
  canonicalEntriesEqual,
  canonicalGitText,
  readCanonicalGit,
  readCanonicalTreeEntry,
} from './git.mts'
import {
  canonicalEligibleSources,
  canonicalProducerAllowed,
  canonicalSourceAllowed,
  findCanonicalProducer,
} from './source.mts'
import { readCanonicalReceipt, validateCanonicalRecipe } from './receipt.mts'
import type { CanonicalGitRead, CanonicalIndexEntry } from './git.mts'
import type { CanonicalPatchRecipe, CanonicalPatchStep } from './receipt.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
export { readCanonicalIndexEntry } from './git.mts'
export { validateCanonicalRecipe } from './receipt.mts'
export type {
  CanonicalGitRead,
  CanonicalIndexEntry,
  CanonicalGitOptions,
  CanonicalGitResult,
} from './git.mts'
export type { CanonicalPatchRecipe, CanonicalPatchStep } from './receipt.mts'

export interface CanonicalProofOptions {
  readGit?: CanonicalGitRead | undefined
  producerAllowed?: ((root: string) => boolean) | undefined
  sourceAllowed?:
    | ((
        member: string,
        producer: string,
        commit: string,
        source: string,
        target: string,
      ) => boolean)
    | undefined
}

function signedParent(
  root: string,
  commit: string,
  readGit: CanonicalGitRead,
): string | undefined {
  if (
    canonicalGitText(
      root,
      ['log', '-1', '--format=%G?', commit],
      readGit,
    )?.trim() !== 'G'
  ) {
    return undefined
  }
  const parents = canonicalGitText(
    root,
    ['rev-list', '--parents', '-n', '1', commit],
    readGit,
  )
    ?.trim()
    .split(' ')
  return parents?.length === 2 && parents[0] === commit ? parents[1] : undefined
}

function stepSourceAllowed(
  member: string,
  recipe: CanonicalPatchRecipe,
  step: CanonicalPatchStep,
  config: CanonicalProofOptions,
): boolean {
  const readGit = config.readGit ?? readCanonicalGit
  const allowed =
    config.sourceAllowed ??
    ((memberRoot, producerRoot, commit, source, target) =>
      canonicalSourceAllowed(
        memberRoot,
        producerRoot,
        commit,
        source,
        target,
        readGit,
      ))
  return allowed(
    member,
    recipe.producerRoot,
    step.commit,
    step.sourcePath,
    step.targetPath,
  )
}

function sourcePatch(
  member: string,
  recipe: CanonicalPatchRecipe,
  step: CanonicalPatchStep,
  config: CanonicalProofOptions,
): Uint8Array | undefined {
  const readGit = config.readGit ?? readCanonicalGit
  const parent = signedParent(recipe.producerRoot, step.commit, readGit)
  if (!parent || !stepSourceAllowed(member, recipe, step, config)) {
    return undefined
  }
  const before = readCanonicalTreeEntry(
    recipe.producerRoot,
    parent,
    step.sourcePath,
    readGit,
  )
  const after = readCanonicalTreeEntry(
    recipe.producerRoot,
    step.commit,
    step.sourcePath,
    readGit,
  )
  if (!before || !after || before.mode !== after.mode) {
    return undefined
  }
  const patch = readGit(recipe.producerRoot, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    parent,
    step.commit,
    '--',
    step.sourcePath,
  ])
  if (patch.status !== 0 || patch.stdout.length === 0) {
    return undefined
  }
  return selectCanonicalPatch(
    Buffer.from(patch.stdout).toString('utf8'),
    step.sourcePath,
    step.hunks,
  )
}

function applyStrictPatch(
  scratch: string,
  patch: Uint8Array,
  strip: number,
): boolean {
  return (
    readCanonicalGit(
      scratch,
      ['apply', '--whitespace=nowarn', `-p${strip}`, '-'],
      { input: patch },
    ).status === 0
  )
}

function applyIndividualHunks(
  scratch: string,
  destination: string,
  patch: Uint8Array,
  strip: number,
): boolean {
  const sections = Buffer.from(patch)
    .toString('utf8')
    .split(/(?=^@@ )/mu)
  const header = sections.shift()
  if (!header || sections.length === 0) {
    return false
  }
  for (let i = 0, { length } = sections; i < length; i += 1) {
    const hunk = Buffer.from(header + sections[i])
    if (applyStrictPatch(scratch, hunk, strip)) {
      continue
    }
    const replacement = applyCanonicalReplacements(
      readFileSync(destination),
      hunk,
    )
    if (!replacement) {
      return false
    }
    writeFileSync(destination, replacement)
  }
  return true
}

function applyProofSteps(
  member: string,
  file: string,
  recipe: CanonicalPatchRecipe,
  baseline: CanonicalIndexEntry,
  config: CanonicalProofOptions,
): Uint8Array | undefined {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'fleet-canonical-proof-'))
  try {
    const destination = path.join(scratch, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, baseline.content)
    chmodSync(destination, baseline.mode === '100755' ? 0o755 : 0o644)
    const seen = new Set<string>()
    const steps = recipe.patches.filter(item => item.targetPath === file)
    for (
      let stepIndex = 0, { length } = steps;
      stepIndex < length;
      stepIndex += 1
    ) {
      const step = steps[stepIndex]!
      if (seen.has(step.commit)) {
        return undefined
      }
      seen.add(step.commit)
      const patch = sourcePatch(member, recipe, step, config)
      if (!patch) {
        return undefined
      }
      const strip =
        normalizePath(step.sourcePath).split('/').length -
        normalizePath(file).split('/').length +
        1
      if (
        !applyStrictPatch(scratch, patch, strip) &&
        (step.application !== 'unique-replacement' ||
          !applyIndividualHunks(scratch, destination, patch, strip))
      ) {
        return undefined
      }
    }
    return readFileSync(destination)
  } finally {
    safeDeleteSync(scratch)
  }
}

export function canonicalRecipeMatches(
  member: string,
  file: string,
  entry: CanonicalIndexEntry,
  value: unknown,
  options: CanonicalProofOptions = {},
): boolean {
  const recipe = validateCanonicalRecipe(value)
  if (!recipe || !recipe.patches.some(step => step.targetPath === file)) {
    return false
  }
  const readGit = options.readGit ?? readCanonicalGit
  if (
    !(options.producerAllowed ?? canonicalProducerAllowed)(recipe.producerRoot)
  ) {
    return false
  }
  if (
    canonicalGitText(
      member,
      ['rev-parse', '--verify', 'HEAD'],
      readGit,
    )?.trim() !== recipe.memberHead
  ) {
    return false
  }
  const baseline = readCanonicalTreeEntry(member, 'HEAD', file, readGit)
  if (!baseline || baseline.mode !== entry.mode) {
    return false
  }
  try {
    const result = applyProofSteps(member, file, recipe, baseline, options)
    return result !== undefined && Buffer.from(result).equals(entry.content)
  } catch {
    return false
  }
}

export function canonicalRecipeCopyMatches(
  member: string,
  file: string,
  entry: CanonicalIndexEntry,
  value: unknown,
  options: CanonicalProofOptions = {},
): boolean {
  const recipe = validateCanonicalRecipe(value)
  const readGit = options.readGit ?? readCanonicalGit
  if (
    !recipe ||
    !(options.producerAllowed ?? canonicalProducerAllowed)(
      recipe.producerRoot,
    ) ||
    canonicalGitText(
      member,
      ['rev-parse', '--verify', 'HEAD'],
      readGit,
    )?.trim() !== recipe.memberHead
  ) {
    return false
  }
  return recipe.patches.some(step => {
    if (
      step.targetPath !== file ||
      !signedParent(recipe.producerRoot, step.commit, readGit) ||
      !stepSourceAllowed(member, recipe, step, options)
    ) {
      return false
    }
    const source = readCanonicalTreeEntry(
      recipe.producerRoot,
      step.commit,
      step.sourcePath,
      readGit,
    )
    return source !== undefined && canonicalEntriesEqual(entry, source)
  })
}

export function canonicalMemberCopyMatches(
  member: string,
  file: string,
  entry: CanonicalIndexEntry,
): boolean {
  const producer = findCanonicalProducer(member)
  if (producer) {
    const head = canonicalGitText(producer, [
      'rev-parse',
      '--verify',
      'HEAD',
    ])?.trim()
    if (head && signedParent(producer, head, readCanonicalGit)) {
      for (const source of canonicalEligibleSources(member, file)) {
        if (!canonicalSourceAllowed(member, producer, head, source, file)) {
          continue
        }
        const committed = readCanonicalTreeEntry(producer, head, source)
        if (committed && canonicalEntriesEqual(entry, committed)) {
          return true
        }
      }
    }
  }
  const receipt = readCanonicalReceipt(member)
  return (
    canonicalRecipeCopyMatches(member, file, entry, receipt) ||
    canonicalRecipeMatches(member, file, entry, receipt)
  )
}
