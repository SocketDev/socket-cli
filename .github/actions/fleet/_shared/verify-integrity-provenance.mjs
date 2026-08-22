/**
 * @file Live provenance + staleness verification for an external-tool asset's
 *   `integrity` pin. The schema (scripts/fleet/lib/external-tools-schema.mts)
 *   lets `integrity` be either a string SRI (`sha512-…==` / `sha256-<hex>`) or
 *   an object `{ value, src?, date? }` carrying provenance — the URL the hash
 *   was fetched from (`src`) and the ISO day it was pinned (`date`). The static
 *   SRI check in install-tool.mjs verifies the DOWNLOADED bytes against
 *   `value`; THIS module verifies `value` itself is still the publisher's
 *   current checksum (so a stale / re-released / tampered pin is caught loudly
 *   rather than silently installing a byte-for-byte match of a hash that no
 *   longer matches the source of truth) and that the pin is not too old. Flow
 *   (wired into install-tool.mjs AFTER the static SRI check, BEFORE
 *   extract/execute): download → SRI-verify against value → live-verify value
 *   against src → staleness-check date → extract/execute. dep-0: runs on the
 *   raw runner before setup-node, so it uses built-ins only (no.
 *
 * @socketsecurity/lib-stable). The fetch is injected via options so unit
 *   tests mock it without touching the network. Pure helpers
 *   (parseChecksumFile, checksumsMatch, checkStaleness) are EXPORTED; the
 *   orchestrator verifyIntegrityProvenance is EXPORTED too — the side-effectful
 *   CLI wiring stays in install-tool.mjs. Every composite-action _shared helper
 *   follows this testability pattern (see
 *   check-fleet-shared-scripts-are-testable).
 */

/**
 * @typedef {Object} ProvenanceOptions
 *
 * @property {typeof fetch} [fetch] - Fetch impl (default global fetch); tests
 *   inject a mock so no network is touched.
 * @property {Date | () => Date} [now] - Clock for the staleness check; tests
 *   inject a fixed date.
 * @property {number} [maxAgeDays] - Staleness threshold (default 90; env
 *   SFW_INTEGRITY_MAX_AGE_DAYS overrides).
 * @property {boolean} [strict] - When true, a stale date FAILS instead of
 *   warning (env SFW_INTEGRITY_STRICT=1).
 * @property {(msg: string) => void} [warn] - Warning sink (default
 *   console.error).
 * @property {string} [assetFilename] - Basename of the asset URL; used to pick
 *   the matching checksum out of a multi-entry checksum file (SHASUMS, go.dev
 *   JSON manifest, Debian Packages index).
 */

/**
 * @typedef {Object} ProvenanceResult
 *
 * @property {boolean} ok - False when the pin must NOT proceed (src mismatch
 *   or strict-mode staleness); true otherwise.
 * @property {string} reason - Human-readable outcome for logging.
 * @property {boolean} [stale] - True when the date crossed the staleness
 *   threshold (warned, or failed under strict).
 * @property {number} [ageDays] - The pin's age in days when date is present.
 * @property {'pass' | 'warn' | 'fail'} [status] - Coarse outcome label.
 */

// ── pure helpers (exported for unit tests) ───────────────────────────────

// The hex length for a given SRI algorithm. sha256 → 64 hex chars (32 bytes),
// sha384 → 96, sha512 → 128. Used to detect the publisher checksum hex form
// (`sha256-<64 hex>`) vs the npm SRI base64 form (`sha512-<base64>==`).
function hexLenFor(algo) {
  return algo === 'sha256' ? 64 : algo === 'sha384' ? 96 : 128
}

// Pull the algorithm + raw digest out of an SRI-ish `value` string
// (`sha256-<hex|base64>` / `sha512-<base64>`). Returns undefined for a non-SRI
// value.
function parseSriValue(value) {
  const m = /^(sha(?:256|384|512))-(.+)$/.exec(value)
  return m ? { algo: m[1], rest: m[2] } : undefined
}

// Walk a parsed JSON value for an object carrying a `sha256` (or `sha512`)
// field, matching `assetFilename` against a sibling `filename` / `name` /
// `path` field when present. The go.dev manifest is an array of releases,
// each with a `files` array of `{ filename, sha256, … }`; rustup-style JSON
// sidecars are a single object. When no assetFilename is given, the first
// hex checksum found is returned. Returns the bare hex string or ''.
function findShaInJson(data, assetFilename) {
  if (typeof data !== 'object' || data === null) {
    return ''
  }
  if (Array.isArray(data)) {
    for (let i = 0, { length } = data; i < length; i += 1) {
      const hex = findShaInJson(data[i], assetFilename)
      if (hex) {
        return hex
      }
    }
    return ''
  }
  // A leaf checksum object: has a sha256 (or sha512) field.
  const hex =
    typeof data.sha256 === 'string' && /^[0-9a-f]+$/i.test(data.sha256)
      ? data.sha256
      : typeof data.sha512 === 'string' && /^[0-9a-f]+$/i.test(data.sha512)
        ? data.sha512
        : ''
  if (hex) {
    if (!assetFilename) {
      return hex
    }
    const name =
      typeof data.filename === 'string'
        ? data.filename
        : typeof data.name === 'string'
          ? data.name
          : typeof data.path === 'string'
            ? data.path
            : ''
    if (!name || basename(name) === assetFilename) {
      return hex
    }
    return ''
  }
  // Recurse into nested objects / arrays (release.files, etc.).
  const keys = Object.keys(data)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const v = data[keys[i]]
    if (typeof v === 'object' && v !== null) {
      const found = findShaInJson(v, assetFilename)
      if (found) {
        return found
      }
    }
  }
  return ''
}

// Parse a Debian Packages index (blank-line-separated stanzas with `Filename:`
// and `SHA256:` fields) for the checksum whose Filename basename matches.
// Returns the bare hex string or ''.
function findShaInPackagesIndex(text, assetFilename) {
  const stanzas = text.split(/\r?\n\s*\r?\n/)
  for (let i = 0, { length } = stanzas; i < length; i += 1) {
    const stanza = stanzas[i]
    if (!/SHA256:/im.test(stanza)) {
      continue
    }
    let filename = ''
    let sha = ''
    const lines = stanza.split(/\r?\n/)
    for (let j = 0, { length: n } = lines; j < n; j += 1) {
      const line = lines[j]
      const fm = /^Filename:\s*(\S+)/i.exec(line)
      if (fm) {
        filename = fm[1]
      }
      const sm = /^SHA256:\s*([0-9a-f]+)/i.exec(line)
      if (sm) {
        sha = sm[1]
      }
    }
    if (sha && (!assetFilename || basename(filename) === assetFilename)) {
      return sha
    }
  }
  return ''
}

// Parse a SHASUMS-style body (`<hash>  <filename>` lines, or a single bare hex
// line) for the checksum whose filename basename matches assetFilename. When
// the body is a single bare hex line, return it. Returns the bare hex or ''.
function parseShasumsLines(text, assetFilename) {
  const lines = text.split(/\r?\n/)
  let firstHex = ''
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i].trim()
    if (!line) {
      continue
    }
    // `<hash>  <filename>` (coreutils shasum shape; optional leading `*` binary
    // marker before the filename).
    const m = /^([0-9a-f]+)\s+\*?(.+)$/.exec(line)
    if (m) {
      const hash = m[1]
      const name = m[2].trim()
      if (!firstHex) {
        firstHex = hash
      }
      if (!assetFilename || basename(name) === assetFilename) {
        return hash
      }
      continue
    }
    // A bare hex line (rustup sidecar is a single `<hash>  rustup-init` line,
    // but some publishers emit the bare hash only).
    if (/^[0-9a-f]+$/i.test(line)) {
      if (!firstHex) {
        firstHex = line
      }
      if (!assetFilename) {
        return line
      }
    }
  }
  // Fall back to the first hash seen when nothing matched by filename — a
  // single-entry sidecar (rustup) names its binary, but the asset basename
  // may differ (e.g. rustup-init.exe vs rustup-init), so the first hash is
  // the safe match for a one-line file.
  return firstHex
}

// POSIX basename: last path segment. Tolerant of both `/` and `\` so a Windows
// repo-relative Filename (`pool\\main\\…`) resolves the same way.
function basename(p) {
  if (!p) {
    return p
  }
  const segs = String(p).split(/[\\/]/)
  return segs[segs.length - 1] || p
}

/**
 * Parse a publisher checksum file body into the bare hex hash for the asset.
 * Handles the three common shapes the fleet's pinned publishers emit:
 *
 * - Bare hex / SHASUMS (`<hash> <filename>` per line) — rustup sidecars.
 * - JSON (go.dev release manifest: `[{ version, files: [{ filename, sha256 }]
 *   }]`).
 * - Debian `Packages` index (stanzas with `Filename:` + `SHA256:`) — Google
 *   Chrome. `assetFilename` (basename of the asset URL) picks the matching
 *   entry out of a multi-file body; when omitted, the first checksum is
 *   returned. Pure.
 *
 * @param {string} text
 * @param {{ assetFilename?: string }} [options]
 *
 * @returns {string} Bare lowercase hex, or '' when no checksum is found.
 */
// oxlint-disable-next-line socket/export-top-level-functions -- dep-0 helper
export function parseChecksumFile(text, options = {}) {
  const opts = { __proto__: null, ...options }
  const assetFilename = opts.assetFilename || ''
  const trimmed = (text || '').trim()
  if (!trimmed) {
    return ''
  }
  // JSON (go.dev manifest is an array; some sidecars are a single object).
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed)
      const hex = findShaInJson(data, assetFilename)
      if (hex) {
        return hex.toLowerCase()
      }
    } catch {
      // Not valid JSON — fall through to the text formats.
    }
  }
  // Debian Packages index.
  if (/^Filename:/im.test(trimmed) && /^SHA256:/im.test(trimmed)) {
    const hex = findShaInPackagesIndex(trimmed, assetFilename)
    if (hex) {
      return hex.toLowerCase()
    }
  }
  // SHASUMS lines or bare hex.
  return parseShasumsLines(trimmed, assetFilename).toLowerCase()
}

/**
 * Compare a pinned `value` (SRI string `sha256-<hex|base64>` /
 * `sha512-<base64>`) against a fetched bare-hex checksum. Returns true when
 * they name the same digest. Handles both the publisher hex form (`sha256-<64
 * hex>`) and the npm SRI base64 form (`sha512-<base64>==`) by converting the
 * fetched hex to the matching shape. Pure.
 *
 * @param {string} value
 * @param {string} fetchedHex
 *
 * @returns {boolean}
 */
// oxlint-disable-next-line socket/export-top-level-functions -- dep-0 helper
export function checksumsMatch(value, fetchedHex) {
  const parsed = parseSriValue(value)
  if (!parsed || !fetchedHex) {
    return false
  }
  const { algo, rest } = parsed
  const hex = fetchedHex.toLowerCase()
  // Publisher hex form: `<algo>-<hex>`.
  if (rest.length === hexLenFor(algo) && /^[0-9a-f]+$/i.test(rest)) {
    return rest.toLowerCase() === hex
  }
  // npm SRI base64 form: convert the fetched hex to base64 + strip padding on
  // both sides (npm strips trailing `=`; the in-process hash keeps it).
  const asBase64 = Buffer.from(hex, 'hex').toString('base64')
  return asBase64.replace(/=+$/, '') === rest.replace(/=+$/, '')
}

/**
 * Staleness check for an ISO-date pin (`YYYY-MM-DD`). Returns the age in days
 * (relative to `now`) plus a `stale` flag for the threshold. Pure given `now`.
 *
 * @param {string} dateString
 * @param {{ now?: Date | (() => Date); maxAgeDays?: number }} [options]
 *
 * @returns {{ stale: boolean; ageDays: number } | undefined} Undefined when no
 *   date / unparseable date.
 */
// oxlint-disable-next-line socket/export-top-level-functions -- dep-0 helper
export function checkStaleness(dateString, options = {}) {
  const opts = { __proto__: null, ...options }
  const date = (dateString || '').trim()
  // ISO calendar date only (YYYY-MM-DD); a datetime is accepted by truncating.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date)
  if (!m) {
    return undefined
  }
  const pinned = Date.parse(m[1] + 'T00:00:00Z')
  if (Number.isNaN(pinned)) {
    return undefined
  }
  const nowOpt = opts.now
  const now =
    typeof nowOpt === 'function'
      ? nowOpt()
      : nowOpt instanceof Date
        ? nowOpt
        : new Date()
  const maxAgeDays =
    typeof opts.maxAgeDays === 'number' && opts.maxAgeDays > 0
      ? opts.maxAgeDays
      : 90
  const ageDays = Math.floor((now.getTime() - pinned) / 86_400_000)
  return { stale: ageDays > maxAgeDays, ageDays }
}

// ── orchestrator (exported; fetch injected for tests) ────────────────────

/**
 * Verify an `integrity` pin's live provenance + staleness. For the STRING form
 * (no src/date), this is a no-op — the static SRI check is the only gate, and
 * existing behavior is unchanged. For the OBJECT form:
 * - `src` present → fetch the publisher's current checksum, parse it, and
 * compare to `value`. A mismatch FAILS (the pin is stale / re-released /
 * possibly compromised — the hash no longer matches the source of truth).
 * - `date` present → staleness check; a pin older than `maxAgeDays` WARNS by
 * default and FAILS only under `strict`.
 *
 * @param {string | { value: string; src?: string; date?: string }} integrity
 * @param {ProvenanceOptions} [options]
 *
 * @returns {Promise<ProvenanceResult>}
 */
// oxlint-disable-next-line socket/export-top-level-functions -- dep-0 helper
export async function verifyIntegrityProvenance(integrity, options = {}) {
  const o = { __proto__: null, ...options }
  const warn =
    o.warn ||
    (msg => {
      // pre-setup-node action; @socketsecurity/lib-stable not installed yet.
      // oxlint-disable-next-line socket/no-console-prefer-logger -- dep-0
      console.error(msg)
    })

  // String form (or absent) → no provenance to check (static SRI is the only
  // gate). Only the object form { value, src?, date? } carries provenance.
  if (typeof integrity !== 'object' || integrity === null) {
    return {
      ok: true,
      reason: 'string integrity — no provenance check',
      status: 'pass',
    }
  }
  const value = integrity.value
  const src = integrity.src
  const date = integrity.date

  // ── src: live provenance check ──────────────────────────────────────────
  if (src) {
    const assetFilename = o.assetFilename || ''
    const fetchImpl = o.fetch || fetch
    let res
    try {
      // pre-setup-node action: built-in fetch only.
      // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- dep-0
      res = await fetchImpl(src, { redirect: 'follow' })
    } catch (e) {
      return {
        ok: false,
        status: 'fail',
        reason: `provenance fetch failed for ${src}: ${e?.message ?? e}`,
      }
    }
    if (!res || !res.ok) {
      return {
        ok: false,
        status: 'fail',
        reason: `provenance fetch failed: HTTP ${res?.status ?? '?'} for ${src}`,
      }
    }
    const text = await res.text()
    const fetched = parseChecksumFile(text, { assetFilename })
    if (!fetched) {
      return {
        ok: false,
        status: 'fail',
        reason: `could not parse a checksum from ${src} for ${assetFilename || '(asset)'}`,
      }
    }
    if (!checksumsMatch(value, fetched)) {
      return {
        ok: false,
        status: 'fail',
        reason: `provenance mismatch: pin ${value} != publisher ${fetched} from ${src}`,
      }
    }
  }

  // ── date: staleness check ───────────────────────────────────────────────
  const maxAgeDays =
    typeof o.maxAgeDays === 'number' && o.maxAgeDays > 0 ? o.maxAgeDays : 90
  const strict = o.strict || false
  if (date) {
    const r = checkStaleness(date, { now: o.now, maxAgeDays })
    if (r) {
      if (r.stale) {
        const msg =
          `· integrity pin is stale: date ${date} is ${r.ageDays} days old ` +
          `(threshold ${maxAgeDays}) — re-verify against ${src || 'the publisher'}`
        if (strict) {
          return {
            ok: false,
            status: 'fail',
            reason: msg,
            stale: true,
            ageDays: r.ageDays,
          }
        }
        warn(msg)
        return {
          ok: true,
          status: 'warn',
          reason: msg,
          stale: true,
          ageDays: r.ageDays,
        }
      }
      return {
        ok: true,
        status: 'pass',
        reason: `pin is ${r.ageDays} days old (within ${maxAgeDays})`,
        ageDays: r.ageDays,
      }
    }
  }

  return {
    ok: true,
    status: 'pass',
    reason: src ? 'provenance verified' : 'no src/date',
  }
}
