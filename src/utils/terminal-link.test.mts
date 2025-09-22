import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

import {
  fileLink,
  mailtoLink,
  socketDashboardLink,
  socketDevLink,
  socketDocsLink,
  socketPackageLink,
  webLink,
} from './terminal-link.mts'

// Mock terminal-link module.
vi.mock('terminal-link', () => ({
  default: vi.fn((text, url) => `[${text}](${url})`),
}))

describe('terminal-link utilities', () => {
  describe('fileLink', () => {
    it('creates link to absolute file path', () => {
      const result = fileLink('/absolute/path/to/file.txt')
      expect(result).toBe('[/absolute/path/to/file.txt](file:///absolute/path/to/file.txt)')
    })

    it('creates link to relative file path', () => {
      const relativePath = 'relative/file.txt'
      const absolutePath = path.resolve(relativePath)
      const result = fileLink(relativePath)
      expect(result).toBe(`[${relativePath}](file://${absolutePath})`)
    })

    it('uses custom text when provided', () => {
      const result = fileLink('/path/to/file.txt', 'Custom Text')
      expect(result).toBe('[Custom Text](file:///path/to/file.txt)')
    })
  })

  describe('mailtoLink', () => {
    it('creates mailto link', () => {
      const result = mailtoLink('test@example.com')
      expect(result).toBe('[test@example.com](mailto:test@example.com)')
    })

    it('uses custom text when provided', () => {
      const result = mailtoLink('test@example.com', 'Email Me')
      expect(result).toBe('[Email Me](mailto:test@example.com)')
    })
  })

  describe('socketDashboardLink', () => {
    it('creates dashboard link with leading slash', () => {
      const result = socketDashboardLink('/org/YOURORG/alerts')
      expect(result).toBe('[https://socket.dev/dashboard/org/YOURORG/alerts](https://socket.dev/dashboard/org/YOURORG/alerts)')
    })

    it('creates dashboard link without leading slash', () => {
      const result = socketDashboardLink('org/YOURORG/settings')
      expect(result).toBe('[https://socket.dev/dashboard/org/YOURORG/settings](https://socket.dev/dashboard/org/YOURORG/settings)')
    })

    it('uses custom text when provided', () => {
      const result = socketDashboardLink('/alerts', 'View Alerts')
      expect(result).toBe('[View Alerts](https://socket.dev/dashboard/alerts)')
    })
  })

  describe('socketDevLink', () => {
    it('creates basic Socket.dev link', () => {
      const result = socketDevLink()
      expect(result).toBe('[Socket.dev](https://socket.dev)')
    })

    it('creates Socket.dev link with custom text', () => {
      const result = socketDevLink('Visit Socket')
      expect(result).toBe('[Visit Socket](https://socket.dev)')
    })

    it('creates Socket.dev link with path', () => {
      const result = socketDevLink('Pricing', '/pricing')
      expect(result).toBe('[Pricing](https://socket.dev/pricing)')
    })

    it('creates Socket.dev link with default text and path', () => {
      const result = socketDevLink(undefined, '/about')
      expect(result).toBe('[Socket.dev](https://socket.dev/about)')
    })
  })

  describe('socketDocsLink', () => {
    it('creates docs link with leading slash', () => {
      const result = socketDocsLink('/docs/api-keys')
      expect(result).toBe('[https://docs.socket.dev/docs/api-keys](https://docs.socket.dev/docs/api-keys)')
    })

    it('creates docs link without leading slash', () => {
      const result = socketDocsLink('docs/cli-reference')
      expect(result).toBe('[https://docs.socket.dev/docs/cli-reference](https://docs.socket.dev/docs/cli-reference)')
    })

    it('uses custom text when provided', () => {
      const result = socketDocsLink('/docs/getting-started', 'Get Started')
      expect(result).toBe('[Get Started](https://docs.socket.dev/docs/getting-started)')
    })
  })

  describe('socketPackageLink', () => {
    it('creates basic package link', () => {
      const result = socketPackageLink('npm', 'express')
      expect(result).toBe('[https://socket.dev/npm/package/express](https://socket.dev/npm/package/express)')
    })

    it('creates package link with version', () => {
      const result = socketPackageLink('npm', 'express', '4.18.0')
      expect(result).toBe('[https://socket.dev/npm/package/express/overview/4.18.0](https://socket.dev/npm/package/express/overview/4.18.0)')
    })

    it('creates package link with path in version', () => {
      const result = socketPackageLink('npm', 'express', 'files/4.18.0/CHANGELOG.md')
      expect(result).toBe('[https://socket.dev/npm/package/express/files/4.18.0/CHANGELOG.md](https://socket.dev/npm/package/express/files/4.18.0/CHANGELOG.md)')
    })

    it('uses custom text when provided', () => {
      const result = socketPackageLink('npm', 'lodash', '4.17.21', 'View Lodash')
      expect(result).toBe('[View Lodash](https://socket.dev/npm/package/lodash/overview/4.17.21)')
    })

    it('handles scoped packages', () => {
      const result = socketPackageLink('npm', '@babel/core')
      expect(result).toBe('[https://socket.dev/npm/package/@babel/core](https://socket.dev/npm/package/@babel/core)')
    })
  })

  describe('webLink', () => {
    it('creates web link', () => {
      const result = webLink('https://example.com')
      expect(result).toBe('[https://example.com](https://example.com)')
    })

    it('uses custom text when provided', () => {
      const result = webLink('https://example.com/page', 'Example Page')
      expect(result).toBe('[Example Page](https://example.com/page)')
    })

    it('handles complex URLs', () => {
      const url = 'https://example.com/path?query=value&other=123#section'
      const result = webLink(url)
      expect(result).toBe(`[${url}](${url})`)
    })
  })
})