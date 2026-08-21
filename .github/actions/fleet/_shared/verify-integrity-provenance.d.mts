/**
 * @file Type declarations for verify-integrity-provenance.mjs — the dep-0
 *   bootstrap helper that live-verifies an integrity pin's `src` provenance +
 *   `date` staleness after the static SRI check. The .mjs is intentionally
 *   untyped (it runs before node_modules); this .d.mts mirrors the EXPORTED
 *   helpers so unit tests can import them with type-checking (same pattern as
 *   install-tool.d.mts). Keep in step with the .mjs exports.
 */

export interface ProvenanceOpts {
  readonly fetch?: typeof fetch | undefined
  readonly now?: Date | (() => Date) | undefined
  readonly maxAgeDays?: number | undefined
  readonly strict?: boolean | undefined
  readonly warn?: ((msg: string) => void) | undefined
  readonly assetFilename?: string | undefined
}

export type ProvenanceStatus = 'pass' | 'warn' | 'fail'

export interface ProvenanceResult {
  readonly ok: boolean
  readonly reason: string
  readonly status?: ProvenanceStatus | undefined
  readonly stale?: boolean | undefined
  readonly ageDays?: number | undefined
}

export type IntegrityWithProvenance = {
  readonly value: string
  readonly src?: string | undefined
  readonly date?: string | undefined
}

export function parseChecksumFile(
  text: string,
  options?: { readonly assetFilename?: string | undefined } | undefined,
): string

export function checksumsMatch(value: string, fetchedHex: string): boolean

export function checkStaleness(
  dateString: string,
  options?: { readonly now?: Date | (() => Date) | undefined; readonly maxAgeDays?: number | undefined } | undefined,
): { readonly stale: boolean; readonly ageDays: number } | undefined

export function verifyIntegrityProvenance(
  integrity: string | IntegrityWithProvenance,
  options?: ProvenanceOpts | undefined,
): Promise<ProvenanceResult>
