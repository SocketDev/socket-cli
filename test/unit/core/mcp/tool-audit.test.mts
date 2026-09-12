import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  auditLogPath,
  emitAuditEvent,
  extractResources,
  maskArgs,
} from '../../../../src/core/mcp/tool-audit.mts'
import type { AuditEntry } from '../../../../src/core/mcp/tool-audit.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const JSON_NULL: unknown = JSON.parse('null')

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ error: logError }),
}))

describe('MCP audit events', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-test-'))
    logError.mockClear()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await safeDelete(directory)
  })

  it('uses the home directory when no audit path is configured', () => {
    vi.stubEnv('SOCKET_MCP_AUDIT_LOG', '')
    expect(auditLogPath()).toBe(
      path.join(os.homedir(), '.socket', 'mcp-audit.jsonl'),
    )
  })

  it('creates the parent directory and appends each event without replacing prior events', () => {
    const file = path.join(directory, 'events', 'audit.jsonl')
    vi.stubEnv('SOCKET_MCP_AUDIT_LOG', file)
    const entry: AuditEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      identity: 'operator',
      requestId: 'example-request',
      tool: 'depscore',
      status: 'success',
      resources: ['pkg:npm/example-package@1.0.0'],
      args: { packages: ['example-package'] },
    }
    const denied = {
      ...entry,
      requestId: 'denied-request',
      status: 'denied' as const,
    }
    emitAuditEvent(entry)
    emitAuditEvent(denied)
    const lines = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/)
    expect(lines.map(line => JSON.parse(line))).toEqual([entry, denied])
    expect(logError).not.toHaveBeenCalled()
  })

  it('reports a failed write without throwing into the tool call', () => {
    vi.stubEnv('SOCKET_MCP_AUDIT_LOG', directory)
    expect(() =>
      emitAuditEvent({
        timestamp: '2026-01-01T00:00:00.000Z',
        identity: 'operator',
        requestId: 'failed-write-request',
        tool: 'depscore',
        status: 'failure',
        resources: [],
        args: {},
      }),
    ).not.toThrow()
    expect(logError).toHaveBeenCalledOnce()
  })
})

describe('MCP audit arguments', () => {
  it('extracts organization, package, version, and explicit package URL resources', () => {
    expect(
      extractResources({
        organization: 'example-org',
        ecosystem: 'npm',
        name: 'example-package',
        version: '1.0.0',
        purl: 'pkg:npm/example-package@1.0.0',
      }),
    ).toEqual([
      'org:example-org',
      'pkg:npm/example-package@1.0.0',
      'purl:pkg:npm/example-package@1.0.0',
    ])
    expect(
      extractResources({
        org: 'preferred-org',
        organization: 'other-org',
        ecosystem: 'npm',
        depname: 'example-package',
      }),
    ).toEqual(['org:preferred-org', 'pkg:npm/example-package'])
    expect(
      extractResources({
        org: '',
        ecosystem: 12,
        depname: JSON_NULL,
        version: false,
        purl: '',
      }),
    ).toEqual([])
  })

  it('redacts sensitive keys recursively without mutating the supplied arguments', () => {
    const args = {
      apiToken: 'example-token',
      nested: {
        PASSWORD: 'example-password',
        options: { credential: 'example-credential', enabled: true },
      },
      packages: ['example-package'],
      optional: JSON_NULL,
    }
    expect(maskArgs(args)).toEqual({
      apiToken: '***REDACTED***',
      nested: {
        PASSWORD: '***REDACTED***',
        options: { credential: '***REDACTED***', enabled: true },
      },
      packages: ['example-package'],
      optional: JSON_NULL,
    })
    expect(args.apiToken).toBe('example-token')
    expect(args.nested.PASSWORD).toBe('example-password')
    expect(args.nested.options.credential).toBe('example-credential')
  })
})
