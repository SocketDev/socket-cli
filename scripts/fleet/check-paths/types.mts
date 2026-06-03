/**
 * @file Shared types for the path-hygiene gate. `Finding` is the canonical
 *   finding shape every scanner produces; `AllowlistEntry` mirrors one
 *   `pathsAllowlist` entry in `.config/socket-wheelhouse.json`. Pure types — no
 *   runtime; importing this file has zero side effects.
 */

export type Finding = {
  rule: 'A' | 'B' | 'C' | 'D' | 'F' | 'G'
  file: string
  line: number
  snippet: string
  message: string
  fix: string
}

export type AllowlistEntry = {
  file?: string | undefined
  pattern?: string | undefined
  rule?: string | undefined
  line?: number | undefined
  snippet_hash?: string | undefined
  reason: string
}
