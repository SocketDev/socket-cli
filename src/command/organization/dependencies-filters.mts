import { getPurlObject } from '../../util/purl/parse.mts'

export type DependenciesPurlsResult =
  | { ok: true; purls: string[] | undefined }
  | { ok: false; message: string }

export function matchesConfirmedPurls(
  requested: readonly string[],
  filters: unknown,
): boolean {
  if (typeof filters !== 'object' || filters === null) {
    return false
  }
  if (!('valid' in filters) || !('invalid' in filters)) {
    return false
  }
  const { valid, invalid } = filters
  if (
    !Array.isArray(valid) ||
    !valid.every(value => typeof value === 'string') ||
    !Array.isArray(invalid) ||
    !invalid.every(value => typeof value === 'string') ||
    invalid.length > 0
  ) {
    return false
  }
  const expected = new Set(requested)
  const actual = new Set(valid)
  return (
    expected.size === requested.length &&
    actual.size === valid.length &&
    expected.size === actual.size &&
    [...expected].every(value => actual.has(value))
  )
}

export function parseDependenciesPurls(
  values: readonly string[] | undefined,
): DependenciesPurlsResult {
  if (values === undefined) {
    return { ok: true, purls: undefined }
  }

  const purls: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const purl = value.trim()
    const parsed =
      purl.startsWith('pkg:') && purl.length > 4
        ? getPurlObject(purl, { throws: false })
        : undefined

    if (!parsed) {
      return {
        ok: false,
        message: `Invalid PURL "${value}". Use a full PURL such as pkg:npm/minimist@1.2.3.`,
      }
    }

    if (Object.keys(parsed.qualifiers ?? {}).length > 0 || parsed.subpath) {
      return {
        ok: false,
        message: `PURL "${value}" includes qualifiers or a subpath, which this search does not support. Search by package identity and version only.`,
      }
    }

    if (!seen.has(purl)) {
      seen.add(purl)
      purls.push(purl)
    }
  }

  if (purls.length === 0) {
    return {
      ok: false,
      message: 'Provide at least one non-empty PURL with --purls.',
    }
  }

  return { ok: true, purls }
}

export function parsePurlsOption(
  argv: readonly string[],
  suppliedPurls: readonly string[] | undefined,
): DependenciesPurlsResult {
  const hasPurlsOption = argv.some(
    argument => argument === '--purls' || argument.startsWith('--purls='),
  )
  if (!hasPurlsOption && suppliedPurls?.length === 0) {
    return { ok: true, purls: undefined }
  }
  return parseDependenciesPurls(
    hasPurlsOption && suppliedPurls === undefined ? [] : suppliedPurls,
  )
}
