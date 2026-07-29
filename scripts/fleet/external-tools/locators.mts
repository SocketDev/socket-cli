/**
 * @file Reads and writes a version pin that lives inside another file.
 *   An external-tools entry's `version` is the single source of truth, and its
 *   `derived` list names every file that has to carry the same value —
 *   `rust-toolchain.toml`'s channel, `.node-version`, a Dockerfile ARG, a
 *   constant in an .mts. Each of those formats needs its own way to find the
 *   value, which is why seven per-tool check scripts each grew their own
 *   copy. This is that logic once, so one generic check can serve every tool.
 *   A reference is `<repo-relative-path>#<locator>`, or a bare path when the
 *   whole file is the pin:
 *   rust-toolchain.toml#toolchain.channel
 *   go.mod#toolchain
 *   docker/fleet/rust-base.Dockerfile#ARG RUST_VERSION
 *   scripts/fleet/update/cargo.mts#RUST_UPDATER_TOOLCHAIN
 *   .node-version
 *   The format is implied by the file, so a reference never restates it.
 *   Every pattern captures three groups — prefix, value, suffix — so a write
 *   substitutes only the value and leaves indentation, quoting, and comments
 *   untouched. That is the same shape the per-tool checks used; a structural
 *   parse-and-reserialize would reformat unrelated lines.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface ParsedPinRef {
  // Repo-relative path to the file holding the pin.
  filePath: string
  // The part after `#`, or undefined when the whole file is the pin.
  locator: string | undefined
}

/**
 * Splits `<path>#<locator>` into its parts. A reference with no `#` is a
 * whole-file pin, so `locator` comes back undefined.
 */
export function parsePinRef(ref: string): ParsedPinRef {
  const hashAt = ref.indexOf('#')
  if (hashAt === -1) {
    return { filePath: ref, locator: undefined }
  }
  return {
    filePath: ref.slice(0, hashAt),
    locator: ref.slice(hashAt + 1).trim() || undefined,
  }
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether the whole file is the pin, e.g. `.node-version` holding `26.5.0`.
 * These carry no key to search for, so they are read and written wholesale.
 */
export function isWholeFilePin(
  locator: string | undefined,
): locator is undefined {
  return locator === undefined
}

/**
 * Builds the prefix/value/suffix pattern for one file format.
 *
 * Returns undefined when the file's format is not one this understands, which
 * the caller should report rather than treat as "no drift" — an unreadable pin
 * that silently passes is the false-green this whole surface exists to avoid.
 */
export function pinPattern(
  filePath: string,
  locator: string,
): RegExp | undefined {
  const base = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()

  // go.mod's `go 1.24.0` / `toolchain go1.24.0` directives.
  if (base === 'go.mod') {
    return new RegExp(`^(${escapeForRegExp(locator)}\\s+)(\\S+)([ \\t]*)$`, 'm')
  }

  // A Dockerfile build arg: `ARG RUST_VERSION=nightly-2026-07-20`. The locator
  // is spelled `ARG NAME`, so lift the name back out of it.
  if (base.endsWith('Dockerfile') || base.startsWith('Dockerfile')) {
    const argName = locator.replace(/^ARG\s+/, '')
    return new RegExp(
      `^(ARG\\s+${escapeForRegExp(argName)}\\s*=\\s*)([^\\s#]+)([ \\t]*)$`,
      'm',
    )
  }

  // CMake: `set(CMAKE_CXX_STANDARD 17)`.
  if (base === 'CMakeLists.txt' || ext === '.cmake') {
    return new RegExp(
      `(set\\s*\\(\\s*${escapeForRegExp(locator)}\\s+)([^)\\s]+)(\\s*\\))`,
      'i',
    )
  }

  // TOML: `channel = "nightly-2026-07-20"`. A dotted locator names the section
  // and key (`toolchain.channel`); only the key is matched, since a fleet pin
  // file never repeats a key across sections.
  if (ext === '.toml') {
    const key = locator.slice(locator.lastIndexOf('.') + 1)
    return new RegExp(`^(\\s*${escapeForRegExp(key)}\\s*=\\s*")([^"]*)(")`, 'm')
  }

  // JSON: `"version": "1.2.3"`. Matched textually rather than parsed so the
  // file's existing formatting survives the write.
  if (ext === '.json') {
    const key = locator.slice(locator.lastIndexOf('.') + 1)
    return new RegExp(`("${escapeForRegExp(key)}"\\s*:\\s*")([^"]*)(")`)
  }

  // A quoted constant in TypeScript/JavaScript:
  // `const RUST_UPDATER_TOOLCHAIN = 'nightly-2026-07-20'`.
  if (['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts'].includes(ext)) {
    return new RegExp(
      `((?:const|let|var)\\s+${escapeForRegExp(locator)}\\s*(?::[^=]+)?=\\s*['"\`])([^'"\`]*)(['"\`])`,
    )
  }

  // YAML: `channel: nightly-2026-07-20`, quotes optional.
  if (ext === '.yaml' || ext === '.yml') {
    const key = locator.slice(locator.lastIndexOf('.') + 1)
    return new RegExp(
      `^(\\s*${escapeForRegExp(key)}\\s*:\\s*['"]?)([^'"\\s#]+)(['"]?[ \\t]*)$`,
      'm',
    )
  }

  return undefined
}

/**
 * Pulls the pinned value out of already-read file content. Returns undefined
 * when the format is unknown or the key is absent.
 */
export function readPinFromContent(
  content: string,
  filePath: string,
  locator: string | undefined,
): string | undefined {
  if (isWholeFilePin(locator)) {
    return content.trim() || undefined
  }
  const pattern = pinPattern(filePath, locator)
  if (!pattern) {
    return undefined
  }
  return pattern.exec(content)?.[2]
}

/**
 * Returns content with the pin set to `value`, or undefined when the format is
 * unknown or the key is absent. Undefined means "could not write" and must not
 * be reported as a successful no-op.
 */
export function writePinToContent(
  content: string,
  filePath: string,
  locator: string | undefined,
  value: string,
): string | undefined {
  if (isWholeFilePin(locator)) {
    // Whole-file pins keep their trailing newline; nothing else is in the file.
    return content.endsWith('\n') ? `${value}\n` : value
  }
  const pattern = pinPattern(filePath, locator)
  if (!pattern) {
    return undefined
  }
  const match = pattern.exec(content)
  if (!match) {
    return undefined
  }
  return content.replace(pattern, `$1${value}$3`)
}

/**
 * Reads the pin named by `ref` (`<path>#<locator>`) relative to `repoRoot`.
 * Returns undefined when the file is missing, the format is unknown, or the
 * key is absent — the caller decides which of those is an error.
 */
export function readPin(repoRoot: string, ref: string): string | undefined {
  const { filePath, locator } = parsePinRef(ref)
  const absolute = path.join(repoRoot, filePath)
  if (!existsSync(absolute)) {
    return undefined
  }
  return readPinFromContent(readFileSync(absolute, 'utf8'), filePath, locator)
}

/**
 * Writes `value` to the pin named by `ref`. Returns true only when the file
 * changed on disk, so a caller can tell a real fix from a no-op and never
 * report an unwritable pin as fixed.
 */
export function writePin(
  repoRoot: string,
  ref: string,
  value: string,
): boolean {
  const { filePath, locator } = parsePinRef(ref)
  const absolute = path.join(repoRoot, filePath)
  if (!existsSync(absolute)) {
    return false
  }
  const content = readFileSync(absolute, 'utf8')
  const next = writePinToContent(content, filePath, locator, value)
  if (next === undefined || next === content) {
    return false
  }
  writeFileSync(absolute, next)
  return true
}
