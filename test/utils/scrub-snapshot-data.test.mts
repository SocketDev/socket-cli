import { describe, expect, it } from 'vitest'

import { scrubSnapshotData, toSnapshotString } from './scrub-snapshot-data.mts'

describe('scrubSnapshotData', () => {
  describe('timestamps', () => {
    it('should scrub ISO timestamps', () => {
      const input =
        'Created at 2025-04-02T01:47:26.914Z and updated 2025-03-31T15:19:55.299Z'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Created at [TIMESTAMP] and updated [TIMESTAMP]')
    })

    it('should scrub ISO timestamps without milliseconds', () => {
      const input = 'Time: 2024-01-01T00:00:00Z'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Time: [TIMESTAMP]')
    })

    it('should scrub date-only formats', () => {
      const input = 'Released on 2025-04-02 and patched 2025-03-31'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Released on [DATE] and patched [DATE]')
    })

    it('should scrub relative time expressions', () => {
      const input =
        'Updated 2 days ago, created 5 minutes ago, and modified 1 hour ago'
      const result = scrubSnapshotData(input)
      expect(result).toBe(
        'Updated [RELATIVE_TIME], created [RELATIVE_TIME], and modified [RELATIVE_TIME]',
      )
    })

    it('should preserve timestamps when disabled', () => {
      const input = 'Created at 2025-04-02T01:47:26.914Z'
      const result = scrubSnapshotData(input, { timestamps: false })
      expect(result).toBe('Created at 2025-04-02T01:47:26.914Z')
    })
  })

  describe('paths', () => {
    it('should scrub Unix home directories', () => {
      const input =
        '/Users/testuser/projects/other-project and /Users/anotheruser/documents/file.txt'
      const result = scrubSnapshotData(input)
      expect(result).toBe(
        '/[HOME]/projects/other-project and /[HOME]/documents/file.txt',
      )
    })

    it('should scrub Linux home directories', () => {
      const input = '/home/user/project/src'
      const result = scrubSnapshotData(input)
      expect(result).toBe('/[HOME]/project/src')
    })

    it('should scrub Windows home directories', () => {
      const input =
        'C:\\Users\\jdalton\\projects and C:\\Users\\TestUser\\Documents'
      const result = scrubSnapshotData(input)
      expect(result).toBe('C:\\[HOME]\\projects and C:\\[HOME]\\Documents')
    })

    it('should scrub project root paths', () => {
      const cwd = process.cwd()
      const input = `Project located at ${cwd}/src/utils`
      const result = scrubSnapshotData(input)
      expect(result).toBe('Project located at [PROJECT]/src/utils')
    })

    it('should scrub Unix temp directories', () => {
      const input =
        'Temp files in /tmp/socket-test-12345 and /tmp/build-abc_123'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Temp files in /[TEMP] and /[TEMP]')
    })

    it('should scrub Windows temp directories', () => {
      const input = 'Temp: \\Temp\\socket-test-456 and \\TEMP\\build-xyz'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Temp: \\[TEMP] and \\[TEMP]')
    })

    it('should preserve paths when disabled', () => {
      const input = '/Users/jdalton/projects/socket-cli'
      const result = scrubSnapshotData(input, { paths: false })
      expect(result).toBe('/Users/jdalton/projects/socket-cli')
    })
  })

  describe('IDs and UUIDs', () => {
    it('should scrub UUIDs', () => {
      const input =
        'ID: 550e8400-e29b-41d4-a716-446655440000 and 123e4567-e89b-12d3-a456-426614174000'
      const result = scrubSnapshotData(input)
      expect(result).toBe('ID: [UUID] and [UUID]')
    })

    it('should scrub scan IDs', () => {
      const input = 'Scans: scan-123, scan-ai-dee, and scan-xyz-789'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Scans: scan-[ID], scan-[ID], and scan-[ID]')
    })

    it('should scrub event IDs in JSON', () => {
      const input = '{"event_id": "123112", "event_id":"456789"}'
      const result = scrubSnapshotData(input)
      expect(result).toBe('{"event_id":"[ID]", "event_id":"[ID]"}')
    })

    it('should preserve IDs when disabled', () => {
      const input = 'ID: 550e8400-e29b-41d4-a716-446655440000'
      const result = scrubSnapshotData(input, { ids: false })
      expect(result).toBe('ID: 550e8400-e29b-41d4-a716-446655440000')
    })
  })

  describe('versions', () => {
    it('should scrub Node versions when enabled', () => {
      const input = 'Node v22.11.0 and v20.10.0'
      const result = scrubSnapshotData(input, { versions: true })
      expect(result).toBe('Node v[VERSION] and v[VERSION]')
    })

    it('should scrub Socket CLI versions when enabled', () => {
      const input = 'socket@1.1.25 and socket@1.0.80'
      const result = scrubSnapshotData(input, { versions: true })
      expect(result).toBe('socket@[VERSION] and socket@[VERSION]')
    })

    it('should preserve versions by default', () => {
      const input = 'Node v22.11.0 and socket@1.1.25'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Node v22.11.0 and socket@1.1.25')
    })
  })

  describe('IP addresses', () => {
    it('should scrub IPv4 addresses', () => {
      const input = 'IPs: 192.168.1.1, 10.0.0.1, and 123.123.321.213'
      const result = scrubSnapshotData(input)
      expect(result).toBe('IPs: [IP], [IP], and [IP]')
    })

    it('should scrub IPv6 addresses', () => {
      const input = 'IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334'
      const result = scrubSnapshotData(input)
      expect(result).toBe('IPv6: [IP]')
    })

    it('should preserve IPs when disabled', () => {
      const input = 'IP: 192.168.1.1'
      const result = scrubSnapshotData(input, { ipAddresses: false })
      expect(result).toBe('IP: 192.168.1.1')
    })
  })

  describe('emails', () => {
    it('should scrub email addresses when enabled', () => {
      const input = 'Contact: person@socket.dev or admin@example.com'
      const result = scrubSnapshotData(input, { emails: true })
      expect(result).toBe('Contact: [EMAIL] or [EMAIL]')
    })

    it('should preserve emails by default', () => {
      const input = 'Contact: person@socket.dev'
      const result = scrubSnapshotData(input)
      expect(result).toBe('Contact: person@socket.dev')
    })
  })

  describe('custom patterns', () => {
    it('should apply custom scrubbing patterns', () => {
      const input = 'API key: abc-123-def and token: xyz-456-uvw'
      const result = scrubSnapshotData(input, {
        custom: [
          { pattern: /[a-z]{3}-\d{3}-[a-z]{3}/g, replacement: '[CUSTOM_KEY]' },
        ],
      })
      expect(result).toBe('API key: [CUSTOM_KEY] and token: [CUSTOM_KEY]')
    })

    it('should apply multiple custom patterns', () => {
      const input = 'Key: SECRET123 and Token: PRIVATE456'
      const result = scrubSnapshotData(input, {
        custom: [
          { pattern: /SECRET\d+/g, replacement: '[SECRET]' },
          { pattern: /PRIVATE\d+/g, replacement: '[PRIVATE]' },
        ],
      })
      expect(result).toBe('Key: [SECRET] and Token: [PRIVATE]')
    })
  })

  describe('comprehensive scrubbing', () => {
    it('should handle complex output with multiple types', () => {
      const input = `
Created: 2025-04-02T01:47:26.914Z
Path: /Users/testuser/projects/some-project
ID: 550e8400-e29b-41d4-a716-446655440000
IP: 192.168.1.1
Updated: 2 days ago
      `.trim()

      const result = scrubSnapshotData(input)

      expect(result).toContain('[TIMESTAMP]')
      expect(result).toContain('/[HOME]/projects/some-project')
      expect(result).toContain('[UUID]')
      expect(result).toContain('[IP]')
      expect(result).toContain('[RELATIVE_TIME]')
    })

    it('should scrub project root path before home directory', () => {
      const cwd = process.cwd()
      const input = `Working in ${cwd}/src/utils`
      const result = scrubSnapshotData(input)
      expect(result).toBe('Working in [PROJECT]/src/utils')
    })
  })

  describe('toSnapshotString', () => {
    it('should apply default scrubbing options', () => {
      const input = `
Time: 2025-04-02T01:47:26.914Z
Path: /Users/jdalton/test
ID: 550e8400-e29b-41d4-a716-446655440000
Version: v22.11.0
Email: test@example.com
      `.trim()

      const result = toSnapshotString(input)

      // Should scrub timestamps, paths, IDs, IPs.
      expect(result).toContain('[TIMESTAMP]')
      expect(result).toContain('/[HOME]/test')
      expect(result).toContain('[UUID]')

      // Should NOT scrub versions or emails by default.
      expect(result).toContain('v22.11.0')
      expect(result).toContain('test@example.com')
    })
  })
})
