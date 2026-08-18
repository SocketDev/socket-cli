/**
 * Structured audit logging for MCP tool executions (SUS-18 / TPSF-2598).
 *
 * Every tool call emits a JSON audit entry to an append-only JSONL file. The
 * entry carries the 7 fields the Salesforce finding requires: a precise
 * timestamp, the authenticated identity, a request identifier, the tool
 * invoked, the execution status, the target resources, and the input arguments
 * with sensitive keys masked.
 *
 * The store is append-only: the emitter opens the file in append mode + writes
 * a single JSON line per event. No entry is ever overwritten or deleted by this
 * module. The file path defaults to `~/.socket/mcp-audit.jsonl` and is
 * overridable via the `SOCKET_MCP_AUDIT_LOG` env var.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

/**
 * One audit event. The shape is stable so a SIEM or export consumer can parse
 * it without per-version logic.
 */
export interface AuditEntry {
  /** ISO 8601 timestamp of the event. */
  readonly timestamp: string
  /** The authenticated identity (a token hash, or `operator` for stdio). */
  readonly identity: string
  /** A per-call request identifier (UUID v4). */
  readonly requestId: string
  /** The MCP tool name. */
  readonly tool: string
  /** `success`, `failure`, or `denied`. */
  readonly status: 'success' | 'failure' | 'denied'
  /** Target resources the tool touched (org slugs, PURLs, etc.), best-effort. */
  readonly resources: readonly string[]
  /** The input arguments with sensitive keys masked. */
  readonly args: Record<string, unknown>
}

// Sensitive argument keys that are redacted to `***REDACTED***` before logging.
// Matched case-insensitively as a substring.
const SENSITIVE_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'private',
  'credential',
  'authorization',
]

const REDACTED = '***REDACTED***'

/**
 * Mask sensitive values in an argument record. A key matching any sensitive
 * pattern (case-insensitive substring) has its value replaced with
 * `***REDACTED***`. Nested objects are masked recursively. Pure.
 */
export function maskArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(args)) {
    const lower = key.toLowerCase()
    const value = args[key]
    if (SENSITIVE_KEY_PATTERNS.some(p => lower.includes(p))) {
      out[key] = REDACTED
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = maskArgs(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * A short, stable hash of a bearer token for the `identity` field. SHA-256 of
 * the token, truncated to 16 hex chars. The raw token is never logged.
 */
export function tokenIdentity(token: string | undefined): string {
  if (!token) {
    return 'operator'
  }
  return 'sha256:' + createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/**
 * Best-effort extraction of target resource identifiers from the arguments.
 * Picks common resource fields (org, organization, ecosystem, depname,
 * version, purl) so the audit entry names what the tool touched.
 */
export function extractResources(
  args: Record<string, unknown>,
): string[] {
  const out: string[] = []
  const org = args['org'] ?? args['organization']
  if (typeof org === 'string' && org) {
    out.push(`org:${org}`)
  }
  const ecosystem = args['ecosystem']
  const depname = args['depname'] ?? args['name']
  const version = args['version']
  if (typeof ecosystem === 'string' && typeof depname === 'string') {
    out.push(
      `pkg:${ecosystem}/${depname}` +
        (typeof version === 'string' ? `@${version}` : ''),
    )
  }
  const purl = args['purl']
  if (typeof purl === 'string' && purl) {
    out.push(`purl:${purl}`)
  }
  return out
}

/**
 * Resolve the audit log file path. `SOCKET_MCP_AUDIT_LOG` env var overrides;
 * default is `~/.socket/mcp-audit.jsonl`.
 */
function auditLogPath(): string {
  const override = process.env['SOCKET_MCP_AUDIT_LOG']
  if (override) {
    return override
  }
  return path.join(homedir(), '.socket', 'mcp-audit.jsonl')
}

const auditLogger = getDefaultLogger()

/**
 * Emit a structured audit event to the append-only JSONL store. The parent
 * directory is created if missing. The file is opened in append mode so
 * concurrent writers do not overwrite each other. A write failure is
 * non-fatal: the tool call proceeds regardless, and the error is surfaced via
 * the logger (not thrown).
 */
export function emitAuditEvent(entry: AuditEntry): void {
  try {
    const filePath = auditLogPath()
    const dir = path.dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8')
  } catch (e) {
    // Non-fatal: the audit log is defense-in-depth, not a gate. A write
    // failure (disk full, permissions) must not break the tool call.
    auditLogger.error(
      `mcp audit log write failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * Generate a per-call request identifier (UUID v4).
 */
export function newRequestId(): string {
  return randomUUID()
}
