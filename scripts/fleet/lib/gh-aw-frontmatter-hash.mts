/**
 * @file Pure-node port of gh-aw v0.83.2's frontmatter_hash recipe — the exact
 *   algorithm the compiler uses to stamp `frontmatter_hash` into a compiled
 *   `.lock.yml`'s `# gh-aw-metadata:` header. Ported from the compiler's own
 *   cross-language pair: `pkg/parser/frontmatter_hash.go` and its pure-JS twin
 *   `actions/setup/js/frontmatter_hash_pure.cjs`, following the Go side where
 *   the two diverge — the Go binary is what stamps the hash. Recipe: extract
 *   the raw frontmatter text between the `---` delimiters after CRLF→LF
 *   normalization; resolve `imports:` transitively via text parsing; build a
 *   canonical map of frontmatter-text, sorted imports, joined imported
 *   frontmatters, and either the full body — `inlined-imports: true` — or the
 *   sorted `${{ env./vars. }}` template expressions; marshal it to
 *   sorted-key compact JSON; sha256 the result. Verified byte-for-byte against
 *   the stamped hashes of this repo's compiled workflows and the compiler's
 *   FH-TV-001/002/003 cross-language vectors. No gh-aw dependency, so the
 *   `gh-aw-locks-are-current` gate can verify frontmatter currency in CI
 *   without the extension installed.
 */
import crypto from 'node:crypto'
import path from 'node:path'

// Mirrors gh-aw's maxFrontmatterHashInputBytes — 1 MiB ceiling over the
// normalized frontmatter text plus every imported frontmatter text.
const MAX_FRONTMATTER_HASH_INPUT_BYTES = 1 << 20

// Injectable file reader for import resolution — returns undefined when the
// file can't be read, matching gh-aw's skip-missing-imports behavior.
export type ReadFileFn = (filePath: string) => string | undefined

export interface FrontmatterAndBody {
  frontmatterText: string
  markdown: string
}

/**
 * Split markdown content into raw frontmatter text and body, the way gh-aw's
 * `extractFrontmatterAndBodyText` does: CRLF→LF first, then line-scan for the
 * opening and closing `---` delimiters — trimmed-line match, so indented or
 * trailing-space delimiters count. Content with no opening `---` is all body.
 * Returns undefined for an unclosed frontmatter block — gh-aw errors there.
 */
export function extractFrontmatterAndBody(
  content: string,
): FrontmatterAndBody | undefined {
  const normalized = content.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines.length === 0 || lines[0]!.trim() !== '---') {
    return { frontmatterText: '', markdown: normalized }
  }
  let endIndex = -1
  for (let i = 1, { length } = lines; i < length; i += 1) {
    if (lines[i]!.trim() === '---') {
      endIndex = i
      break
    }
  }
  if (endIndex === -1) {
    return undefined
  }
  return {
    frontmatterText: lines.slice(1, endIndex).join('\n'),
    markdown:
      endIndex + 1 < lines.length ? lines.slice(endIndex + 1).join('\n') : '',
  }
}

/**
 * Gh-aw's `normalizeFrontmatterText`: CRLF→LF, then trim surrounding
 * whitespace.
 */
export function normalizeHashText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim()
}

/**
 * Text-parse the `imports:` array from raw frontmatter text — gh-aw's
 * `extractImportsFromText`, array form: items indented under `imports:`,
 * with `uses:`/`path:` object-form prefixes unwrapped and quotes stripped.
 */
export function extractImportsFromText(frontmatterText: string): string[] {
  const imports: string[] = []
  const lines = frontmatterText.split('\n')
  let inImports = false
  let baseIndent = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    if (trimmed.startsWith('imports:')) {
      inImports = true
      // First non-whitespace column — the indent depth of the imports: key.
      baseIndent = line.search(/\S/u)
      continue
    }
    if (!inImports) {
      continue
    }
    // First non-whitespace column of the current line.
    const lineIndent = line.search(/\S/u)
    if (lineIndent <= baseIndent) {
      break
    }
    if (trimmed.startsWith('-')) {
      let item = trimmed.slice(1).trim()
      if (item.startsWith('uses:')) {
        item = item.slice('uses:'.length).trim()
      } else if (item.startsWith('path:')) {
        item = item.slice('path:'.length).trim()
      }
      // Strip one layer of surrounding single or double quotes.
      item = item.replace(/^["']|["']$/gu, '')
      if (item) {
        imports.push(item)
      }
    }
  }
  return imports
}

/**
 * Gh-aw's `extractRelevantTemplateExpressions` — Go semantics: non-greedy
 * `${{ ... }}` matches that never cross a newline, kept only when the inner
 * text references `env.` or `vars.`, deduplicated, sorted.
 */
export function extractRelevantTemplateExpressions(markdown: string): string[] {
  const seen = new Set<string>()
  // Non-greedy ${{ ... }} template expression — `.` excludes newlines, same
  // as Go's RE2 default, so a delimiter pair split across lines never matches.
  const re = /\$\{\{(.*?)\}\}/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const inner = m[1]!.trim()
    if (inner.includes('env.') || inner.includes('vars.')) {
      seen.add(m[0])
    }
  }
  return [...seen].toSorted()
}

type CanonicalValue = string | readonly string[]

/**
 * Gh-aw's `marshalSorted` for the canonical hash payload: compact JSON with
 * object keys sorted, string values via JSON.stringify — which matches Go's
 * no-HTML-escape compact marshal for this string/array-of-string shape.
 */
export function marshalSorted(
  data: Readonly<Record<string, CanonicalValue>>,
): string {
  const keys = Object.keys(data).toSorted()
  if (keys.length === 0) {
    return '{}'
  }
  const pairs = keys.map(key => {
    const value = data[key]!
    const valueJson = Array.isArray(value)
      ? value.length === 0
        ? '[]'
        : `[${value.map(v => JSON.stringify(v)).join(',')}]`
      : JSON.stringify(value)
    return `${JSON.stringify(key)}:${valueJson}`
  })
  return `{${pairs.join(',')}}`
}

// Transitive import walk — collects import paths and their raw frontmatter
// texts in gh-aw's deterministic order: sorted per level, depth-first, with
// visited-set cycle protection. Unreadable or malformed imports are skipped
// silently, matching the compiler.
function collectImports(
  frontmatterText: string,
  baseDir: string,
  readFile: ReadFileFn,
  visited: Set<string>,
  importedFiles: string[],
  importedFrontmatterTexts: string[],
): void {
  const imports = extractImportsFromText(frontmatterText).toSorted()
  for (let i = 0, { length } = imports; i < length; i += 1) {
    const importPath = imports[i]!
    const fullPath = path.join(baseDir, importPath)
    if (visited.has(fullPath)) {
      continue
    }
    visited.add(fullPath)
    const content = readFile(fullPath)
    if (content === undefined) {
      continue
    }
    const split = extractFrontmatterAndBody(content)
    if (split === undefined) {
      continue
    }
    importedFiles.push(importPath)
    importedFrontmatterTexts.push(split.frontmatterText)
    collectImports(
      split.frontmatterText,
      path.dirname(fullPath),
      readFile,
      visited,
      importedFiles,
      importedFrontmatterTexts,
    )
  }
}

export interface FrontmatterHashConfig {
  // Directory of the .md source — import paths resolve relative to it.
  baseDir: string
  // Reader for imported files; a workflow with no imports never calls it.
  readFile?: ReadFileFn | undefined
}

/**
 * Compute the gh-aw v0.83.2 `frontmatter_hash` for a workflow .md's content.
 * Returns undefined when the content is unhashable — unclosed frontmatter, or
 * normalized input past the compiler's 1 MiB ceiling.
 */
export function frontmatterHashOf(
  content: string,
  config: FrontmatterHashConfig,
): string | undefined {
  const { baseDir, readFile = () => undefined } = {
    __proto__: null,
    ...config,
  } as FrontmatterHashConfig
  const split = extractFrontmatterAndBody(content)
  if (split === undefined) {
    return undefined
  }
  const { frontmatterText, markdown } = split
  // gh-aw detects the flag by text scan on the raw frontmatter — a top-level
  // `inlined-imports: true` line.
  const inlinedImports = /^inlined-imports:\s*true\s*$/mu.test(frontmatterText)
  const importedFiles: string[] = []
  const importedFrontmatterTexts: string[] = []
  collectImports(
    frontmatterText,
    baseDir,
    readFile,
    new Set<string>(),
    importedFiles,
    importedFrontmatterTexts,
  )

  const normalizedFrontmatter = normalizeHashText(frontmatterText)
  const normalizedImported = importedFrontmatterTexts.map(normalizeHashText)
  let totalBytes = Buffer.byteLength(normalizedFrontmatter, 'utf8')
  for (let i = 0, { length } = normalizedImported; i < length; i += 1) {
    const text = normalizedImported[i]!
    totalBytes += Buffer.byteLength(text, 'utf8')
  }
  if (totalBytes > MAX_FRONTMATTER_HASH_INPUT_BYTES) {
    return undefined
  }

  const canonical: Record<string, CanonicalValue> = {
    'frontmatter-text': normalizedFrontmatter,
  }
  if (importedFiles.length > 0) {
    canonical['imports'] = importedFiles.toSorted()
  }
  if (normalizedImported.length > 0) {
    canonical['imported-frontmatters'] = normalizedImported
      .toSorted()
      .join('\n---\n')
  }
  if (inlinedImports) {
    canonical['body-text'] = normalizeHashText(markdown)
  } else {
    const expressions = extractRelevantTemplateExpressions(markdown)
    if (expressions.length > 0) {
      canonical['template-expressions'] = expressions
    }
  }

  return crypto
    .createHash('sha256')
    .update(marshalSorted(canonical), 'utf8')
    .digest('hex')
}

export interface EmbeddedLockHashes {
  bodyHash: string | undefined
  frontmatterHash: string | undefined
}

/**
 * Parse the `# gh-aw-metadata: {...}` header line of a compiled `.lock.yml`
 * and return its stamped body_hash + frontmatter_hash. Either is undefined
 * when the line is absent, malformed, or missing that field.
 */
export function embeddedLockHashes(lockText: string): EmbeddedLockHashes {
  const lines = lockText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // The metadata header line: `# gh-aw-metadata:` followed by one JSON object.
    const m = /^#\s*gh-aw-metadata:\s*(\{.+\})/u.exec(lines[i]!)
    if (!m) {
      continue
    }
    try {
      const metadata = JSON.parse(m[1]!) as {
        body_hash?: unknown | undefined
        frontmatter_hash?: unknown | undefined
      }
      return {
        bodyHash:
          typeof metadata.body_hash === 'string'
            ? metadata.body_hash
            : undefined,
        frontmatterHash:
          typeof metadata.frontmatter_hash === 'string'
            ? metadata.frontmatter_hash
            : undefined,
      }
    } catch {
      return { bodyHash: undefined, frontmatterHash: undefined }
    }
  }
  return { bodyHash: undefined, frontmatterHash: undefined }
}
