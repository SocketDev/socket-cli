/**
 * @fileoverview EditableJson utility for non-destructive JSON file manipulation.
 * Preserves formatting (indentation and line endings) when updating JSON files.
 * This is a standalone implementation copied from @socketsecurity/lib/json/edit.
 */

import { promises as fs } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

// Symbols used to store formatting metadata in JSON objects.
const INDENT_SYMBOL = Symbol.for('indent')
const NEWLINE_SYMBOL = Symbol.for('newline')

/**
 * Formatting metadata for JSON files.
 */
interface JsonFormatting {
  indent: string | number
  newline: string
}

/**
 * Options for saving editable JSON files.
 */
interface EditableJsonSaveOptions {
  /**
   * Whether to ignore whitespace-only changes when determining if save is needed.
   * @default false
   */
  ignoreWhitespace?: boolean | undefined
  /**
   * Whether to sort object keys alphabetically before saving.
   * @default false
   */
  sort?: boolean | undefined
}

/**
 * Detect indentation from a JSON string.
 * Supports space-based indentation (returns count) or mixed indentation (returns string).
 */
function detectIndent(json: string): string | number {
  const match = json.match(/^[{[][\r\n]+(\s+)/m)
  if (!match) {
    return 2
  }
  const indent = match[1]
  if (/^ +$/.test(indent)) {
    return indent.length
  }
  return indent
}

/**
 * Detect newline character(s) from a JSON string.
 * Supports LF (\n) and CRLF (\r\n) line endings.
 */
function detectNewline(json: string): string {
  const match = json.match(/\r?\n/)
  return match ? match[0] : '\n'
}

/**
 * Get default formatting for JSON files.
 */
function getDefaultFormatting(): JsonFormatting {
  return {
    indent: 2,
    newline: '\n',
  }
}

/**
 * Sort object keys alphabetically.
 * Creates a new object with sorted keys (does not mutate input).
 */
function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = { __proto__: null } as Record<
    string,
    unknown
  >
  const keys = Object.keys(obj).sort()
  for (const key of keys) {
    sorted[key] = obj[key]
  }
  return sorted
}

/**
 * Stringify JSON with specific formatting.
 * Applies indentation and line ending preferences.
 */
function stringifyWithFormatting(
  content: Record<string, unknown>,
  formatting: JsonFormatting,
): string {
  const { indent, newline } = formatting
  const format = indent === undefined || indent === null ? '  ' : indent
  const eol = newline === undefined || newline === null ? '\n' : newline
  return `${JSON.stringify(content, undefined, format)}\n`.replace(/\n/g, eol)
}

/**
 * Strip formatting symbols from content object.
 * Removes Symbol.for('indent') and Symbol.for('newline') from the object.
 */
function stripFormattingSymbols(
  content: Record<string | symbol, unknown>,
): Record<string, unknown> {
  const {
    [INDENT_SYMBOL]: _indent,
    [NEWLINE_SYMBOL]: _newline,
    ...rest
  } = content
  return rest as Record<string, unknown>
}

/**
 * Extract formatting from content object that has symbol-based metadata.
 */
function getFormattingFromContent(
  content: Record<string | symbol, unknown>,
): JsonFormatting {
  const indent = content[INDENT_SYMBOL]
  const newline = content[NEWLINE_SYMBOL]
  return {
    indent:
      indent === undefined || indent === null ? 2 : (indent as string | number),
    newline:
      newline === undefined || newline === null ? '\n' : (newline as string),
  }
}

/**
 * Determine if content should be saved based on changes and options.
 */
function shouldSave(
  currentContent: Record<string | symbol, unknown>,
  originalContent: Record<string | symbol, unknown> | undefined,
  originalFileContent: string,
  options: EditableJsonSaveOptions = {},
): boolean {
  const { ignoreWhitespace = false, sort = false } = options
  const content = stripFormattingSymbols(currentContent)
  const sortedContent = sort ? sortKeys(content) : content
  const origContent = originalContent
    ? stripFormattingSymbols(originalContent)
    : {}

  if (ignoreWhitespace) {
    return !isDeepStrictEqual(sortedContent, origContent)
  }

  const formatting = getFormattingFromContent(currentContent)
  const newFileContent = stringifyWithFormatting(sortedContent, formatting)
  return newFileContent.trim() !== originalFileContent.trim()
}

/**
 * Retry write operation with exponential backoff for file system issues.
 */
async function retryWrite(
  filepath: string,
  content: string,
  retries = 3,
  baseDelay = 10,
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.writeFile(filepath, content)
      if (process.platform === 'win32') {
        await setTimeout(50)
        let accessRetries = 0
        const maxAccessRetries = 5
        // eslint-disable-next-line no-await-in-loop
        while (accessRetries < maxAccessRetries) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.access(filepath)
            // eslint-disable-next-line no-await-in-loop
            await setTimeout(10)
            break
          } catch {
            const delay = 20 * (accessRetries + 1)
            // eslint-disable-next-line no-await-in-loop
            await setTimeout(delay)
            accessRetries++
          }
        }
      }
      return
    } catch (err) {
      const isLastAttempt = attempt === retries
      const isRetriableError =
        err instanceof Error &&
        'code' in err &&
        (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'ENOENT')
      if (!isRetriableError || isLastAttempt) {
        throw err
      }
      const delay = baseDelay * 2 ** attempt
      // eslint-disable-next-line no-await-in-loop
      await setTimeout(delay)
    }
  }
}

/**
 * Parse JSON string.
 */
function parseJson(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>
}

/**
 * Read file with retry logic for file system issues.
 */
async function readFile(filepath: string): Promise<string> {
  const maxRetries = process.platform === 'win32' ? 5 : 1
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fs.readFile(filepath, 'utf8')
    } catch (err) {
      const isLastAttempt = attempt === maxRetries
      const isEnoent =
        err instanceof Error && 'code' in err && err.code === 'ENOENT'
      if (!isEnoent || isLastAttempt) {
        throw err
      }
      const delay = process.platform === 'win32' ? 50 * (attempt + 1) : 20
      // eslint-disable-next-line no-await-in-loop
      await setTimeout(delay)
    }
  }
  throw new Error('Unreachable code')
}

/**
 * EditableJson class for non-destructive JSON file manipulation.
 * Preserves formatting when updating JSON files.
 */
export class EditableJson<T = Record<string, unknown>> {
  private _canSave = true
  private _content: Record<string | symbol, unknown> = {}
  private _path: string | undefined = undefined
  private _readFileContent = ''
  private _readFileJson: Record<string, unknown> | undefined = undefined

  get content(): Readonly<T> {
    return this._content as Readonly<T>
  }

  get filename(): string {
    const path = this._path
    if (!path) {
      return ''
    }
    return path
  }

  get path(): string | undefined {
    return this._path
  }

  /**
   * Create a new JSON file instance.
   */
  create(path: string): this {
    this._path = path
    this._content = {}
    this._canSave = true
    return this
  }

  /**
   * Initialize from content object (disables saving).
   */
  fromContent(data: unknown): this {
    this._content = data as Record<string | symbol, unknown>
    this._canSave = false
    return this
  }

  /**
   * Initialize from JSON string.
   */
  fromJSON(data: string): this {
    const parsed = parseJson(data)
    const indent = detectIndent(data)
    const newline = detectNewline(data)
    parsed[INDENT_SYMBOL] = indent
    parsed[NEWLINE_SYMBOL] = newline
    this._content = parsed as Record<string | symbol, unknown>
    return this
  }

  /**
   * Load JSON file from disk.
   */
  async load(path: string, create?: boolean): Promise<this> {
    this._path = path
    try {
      this._readFileContent = await readFile(this.filename)
      this.fromJSON(this._readFileContent)
      this._readFileJson = parseJson(this._readFileContent)
    } catch (err) {
      if (!create) {
        throw err
      }
      // File doesn't exist and create is true - initialize empty.
      this._content = {}
      this._readFileContent = ''
      this._readFileJson = undefined
      this._canSave = true
    }
    return this
  }

  /**
   * Update content with new values.
   */
  update(content: Partial<T>): this {
    this._content = {
      ...this._content,
      ...content,
    }
    return this
  }

  /**
   * Save JSON file to disk asynchronously.
   */
  async save(options?: EditableJsonSaveOptions): Promise<boolean> {
    if (!this._canSave || this.content === undefined) {
      throw new Error('No file path to save to')
    }
    if (
      !shouldSave(
        this._content,
        this._readFileJson as Record<string | symbol, unknown> | undefined,
        this._readFileContent,
        options,
      )
    ) {
      return false
    }
    const content = stripFormattingSymbols(this._content)
    const sortedContent = options?.sort ? sortKeys(content) : content
    const formatting = getFormattingFromContent(this._content)
    const fileContent = stringifyWithFormatting(sortedContent, formatting)
    await retryWrite(this.filename, fileContent)
    this._readFileContent = fileContent
    this._readFileJson = parseJson(fileContent)
    return true
  }

  /**
   * Check if save will occur based on current changes.
   */
  willSave(options?: EditableJsonSaveOptions): boolean {
    if (!this._canSave || this.content === undefined) {
      return false
    }
    return shouldSave(
      this._content,
      this._readFileJson as Record<string | symbol, unknown> | undefined,
      this._readFileContent,
      options,
    )
  }
}

/**
 * Get the EditableJson class for JSON file manipulation.
 */
export function getEditableJsonClass<
  T = Record<string, unknown>,
>(): typeof EditableJson<T> {
  return EditableJson as typeof EditableJson<T>
}
