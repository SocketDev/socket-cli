/**
 * Shared types for the check-new-deps hook. Pure type definitions —
 * no runtime side effects, so both index.mts and audit.mts can import
 * without circularity concerns.
 */

// Extracted dependency with ecosystem type, name, and optional scope.
export interface Dep {
  type: string
  name: string
  namespace?: string
  version?: string
}

// Shape of the JSON blob Claude Code pipes to the hook via stdin.
export interface HookInput {
  tool_name: string
  tool_input?: {
    file_path?: string
    new_string?: string
    old_string?: string
    content?: string
  }
  // Optional context Claude Code passes when invoking a hook. We only
  // read the basename of transcript_path to scope the audit log to
  // session; the file itself is never opened.
  transcript_path?: string
  session_id?: string
}

// Verdict recorded for each checked dep in the audit log. Kept narrow
// so an external tail-the-jsonl process can switch on it directly.
export type Verdict = 'allow' | 'block' | 'notfound' | 'unknown'

// Result of checking a single dep against the Socket.dev API.
export interface CheckResult {
  purl: string
  blocked?: boolean
  reason?: string
}

// Per-batch outcome breakdown so the caller can route into audit
// logging + slopsquatting accounting without re-deriving anything.
export interface BatchOutcome {
  blocked: CheckResult[]
  // PURLs the API didn't recognize. The firewall path silently drops
  // 404s, the batch path returns them with `score === undefined`; we
  // detect both shapes by diffing requested PURLs vs returned ones.
  notFound: Set<string>
  // PURLs the API confirmed exist and are clean. Anything in this
  // set is recorded as `verdict: 'allow'`.
  ok: Set<string>
}

// Persistent shape stored in the 404 TTL cache. We track count +
// first/last timestamps so a future tool can surface "this dep has
// been requested N times across M sessions" without a separate
// counter.
export interface NotFoundEntry {
  count: number
  firstSeenAt: number
  lastSeenAt: number
}

// Single record written to the audit log. The shape is intentionally
// flat so each line greps cleanly. session/range may be undefined
// when the corresponding Claude Code field wasn't piped through.
export interface AuditRecord {
  ts: number
  repo: string
  type: string
  name: string
  namespace?: string | undefined
  version?: string | undefined
  verdict: Verdict
  reason?: string | undefined
  session?: string | undefined
}
