/**
 * @fileoverview Shared types for the path-hygiene gate.
 *
 * `Finding` is the canonical finding shape every scanner produces;
 * `AllowlistEntry` mirrors the YAML row shape in
 * `.github/paths-allowlist.yml`. Pure types — no runtime; importing
 * this file has zero side effects.
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
  file?: string
  pattern?: string
  rule?: string
  line?: number
  snippet_hash?: string
  reason: string
}
