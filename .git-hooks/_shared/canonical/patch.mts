/**
 * @file Select complete context-preserving hunks from an immutable Git patch.
 */
export function canonicalHunksAreValid(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 128 &&
    value.every(
      (index, position) =>
        Number.isSafeInteger(index) &&
        index >= 0 &&
        (position === 0 || index > value[position - 1]),
    )
  )
}

export function selectCanonicalPatch(
  text: string,
  source: string,
  selected?: readonly number[] | undefined,
): Uint8Array | undefined {
  if (
    !text.startsWith(`diff --git a/${source} b/${source}\n`) ||
    text.split('\ndiff --git ').length !== 1
  ) {
    return undefined
  }
  if (
    /^(?:Binary files |GIT binary patch|copy |deleted file mode|new file mode|new mode|old mode|rename )/mu.test(
      text,
    )
  ) {
    return undefined
  }
  const sections = text.split(/(?=^@@ )/mu)
  const header = sections.shift()
  if (
    !header?.includes(`--- a/${source}\n+++ b/${source}\n`) ||
    sections.length === 0
  ) {
    return undefined
  }
  const indexes = selected ?? [...sections.keys()]
  if (
    !canonicalHunksAreValid(indexes) ||
    indexes.some(index => index >= sections.length)
  ) {
    return undefined
  }
  return Buffer.from(header + indexes.map(index => sections[index]).join(''))
}
