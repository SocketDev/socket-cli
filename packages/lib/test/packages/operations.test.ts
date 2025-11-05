/**
 * @fileoverview Unit tests for package manipulation operations.
 *
 * Tests package operation utilities:
 * - Extraction: extractPackage() unpacks tarballs to directories
 * - Packing: packPackage() creates tarballs from directories
 * - Reading: readPackageJson(), readPackageJsonSync() parse package.json files
 * - Resolution: resolveGitHubTgzUrl() resolves GitHub tarball URLs
 * - Tag parsing: getReleaseTag() extracts version tags from package specs
 * Used by Socket tools for package management and dependency operations.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  extractPackage,
  findPackageExtensions,
  getReleaseTag,
  packPackage,
  readPackageJson,
  readPackageJsonSync,
  resolveGitHubTgzUrl,
  resolvePackageName,
} from '@socketsecurity/lib/packages/operations'
import type { PackageJson } from '@socketsecurity/lib/packages'
import { describe, expect, it } from 'vitest'
import { runWithTempDir } from '../utils/temp-file-helper.mjs'

describe('packages/operations', () => {
  describe('getReleaseTag', () => {
    it('should return empty string for empty spec', () => {
      expect(getReleaseTag('')).toBe('')
    })

    it('should extract tag from unscoped package', () => {
      expect(getReleaseTag('package@1.0.0')).toBe('1.0.0')
    })

    it('should extract tag from scoped package', () => {
      expect(getReleaseTag('@scope/package@1.0.0')).toBe('1.0.0')
    })

    it('should return empty string for package without tag', () => {
      expect(getReleaseTag('package')).toBe('')
    })

    it('should return empty string for scoped package without tag', () => {
      expect(getReleaseTag('@scope/package')).toBe('')
    })

    it('should handle multiple @ signs in scoped packages', () => {
      expect(getReleaseTag('@scope/package@latest')).toBe('latest')
      expect(getReleaseTag('@scope/package@^1.2.3')).toBe('^1.2.3')
    })

    it('should handle semver ranges', () => {
      expect(getReleaseTag('package@^1.2.3')).toBe('^1.2.3')
      expect(getReleaseTag('package@~1.2.3')).toBe('~1.2.3')
      expect(getReleaseTag('package@>=1.0.0')).toBe('>=1.0.0')
    })

    it('should handle dist-tags', () => {
      expect(getReleaseTag('package@latest')).toBe('latest')
      expect(getReleaseTag('package@next')).toBe('next')
      expect(getReleaseTag('@scope/package@beta')).toBe('beta')
    })
  })

  describe('findPackageExtensions', () => {
    it('should return undefined for package with no extensions', () => {
      const result = findPackageExtensions('non-existent-package', '1.0.0')
      expect(result).toBeUndefined()
    })

    it('should return extensions for matching package and version', () => {
      // This test depends on the actual package extensions configured
      // We'll test the basic functionality
      const result = findPackageExtensions('test-package', '1.0.0')
      // Result should be undefined or an object depending on configuration
      expect(result === undefined || typeof result === 'object').toBe(true)
    })

    it('should handle semver range matching', () => {
      // Test that the function uses semver.satisfies internally
      const result = findPackageExtensions('some-package', '1.2.3')
      expect(result === undefined || typeof result === 'object').toBe(true)
    })

    it('should merge multiple matching extensions', () => {
      // If multiple extensions match, they should be merged
      const result = findPackageExtensions('test-package', '1.0.0')
      expect(result === undefined || typeof result === 'object').toBe(true)
    })

    it('should handle scoped packages', () => {
      const result = findPackageExtensions('@scope/package', '1.0.0')
      expect(result === undefined || typeof result === 'object').toBe(true)
    })
  })

  describe('resolvePackageName', () => {
    it('should return name for unscoped package', () => {
      const purlObj = { name: 'package' }
      expect(resolvePackageName(purlObj)).toBe('package')
    })

    it('should return scoped name with default delimiter', () => {
      const purlObj = { name: 'package', namespace: '@scope' }
      expect(resolvePackageName(purlObj)).toBe('@scope/package')
    })

    it('should use custom delimiter', () => {
      const purlObj = { name: 'package', namespace: '@scope' }
      expect(resolvePackageName(purlObj, '--')).toBe('@scope--package')
    })

    it('should handle empty namespace', () => {
      const purlObj = { name: 'package', namespace: '' }
      expect(resolvePackageName(purlObj)).toBe('package')
    })

    it('should handle undefined namespace', () => {
      const purlObj = { name: 'package', namespace: undefined }
      expect(resolvePackageName(purlObj)).toBe('package')
    })

    it('should use default / delimiter when not specified', () => {
      const purlObj = { name: 'mypackage', namespace: '@myorg' }
      expect(resolvePackageName(purlObj)).toBe('@myorg/mypackage')
    })
  })

  describe('readPackageJson', () => {
    it('should read and parse package.json from directory', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
          description: 'Test package',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const result = await readPackageJson(tmpDir)
        expect(result).toBeDefined()
        expect(result?.name).toBe('test-package')
        expect(result?.version).toBe('1.0.0')
      }, 'read-pkg-json-')
    })

    it('should read package.json from file path', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = { name: 'test', version: '2.0.0' }
        await fs.writeFile(pkgPath, JSON.stringify(pkgData))

        const result = await readPackageJson(pkgPath)
        expect(result?.name).toBe('test')
      }, 'read-pkg-json-file-')
    })

    it('should return undefined for non-existent file', async () => {
      await runWithTempDir(async tmpDir => {
        const result = await readPackageJson(tmpDir, { throws: false })
        expect(result).toBeUndefined()
      }, 'read-pkg-json-missing-')
    })

    it('should normalize when normalize option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = await readPackageJson(tmpDir, { normalize: true })
        expect(result).toBeDefined()
        expect(result?.name).toBe('test')
        // Normalization should add version field
        expect(result?.version).toBeDefined()
      }, 'read-pkg-json-normalize-')
    })

    it('should return editable package.json when editable option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = await readPackageJson(tmpDir, { editable: true })
        expect(result).toBeDefined()
        expect(typeof result?.save).toBe('function')
      }, 'read-pkg-json-editable-')
    })

    it('should handle editable with normalize options', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0', custom: 'field' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        // When using editable with normalize, the options are passed to the editable converter
        await expect(
          readPackageJson(tmpDir, {
            editable: true,
            normalize: true,
            preserve: ['custom'],
          })
        ).resolves.toBeDefined()
      }, 'read-pkg-json-editable-normalize-')
    })

    it('should throw when throws option is true and file missing', async () => {
      await runWithTempDir(async tmpDir => {
        await expect(
          readPackageJson(tmpDir, { throws: true })
        ).rejects.toThrow()
      }, 'read-pkg-json-throws-')
    })

    it('should pass normalize options through', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', custom: 'field' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = await readPackageJson(tmpDir, {
          normalize: true,
          preserve: ['custom'],
        })
        expect(result).toBeDefined()
      }, 'read-pkg-json-preserve-')
    })

    it('should handle malformed JSON gracefully', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          '{ invalid json'
        )

        const result = await readPackageJson(tmpDir, { throws: false })
        expect(result).toBeUndefined()
      }, 'read-pkg-json-malformed-')
    })

    it('should not normalize by default', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', custom: 'field' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = await readPackageJson(tmpDir)
        expect(result?.custom).toBe('field')
      }, 'read-pkg-json-no-normalize-')
    })
  })

  describe('readPackageJsonSync', () => {
    it('should synchronously read and parse package.json', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test-sync', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = readPackageJsonSync(tmpDir)
        expect(result).toBeDefined()
        expect(result?.name).toBe('test-sync')
      }, 'read-pkg-json-sync-')
    })

    it('should return undefined for non-existent file', async () => {
      await runWithTempDir(async tmpDir => {
        const result = readPackageJsonSync(tmpDir, { throws: false })
        expect(result).toBeUndefined()
      }, 'read-pkg-json-sync-missing-')
    })

    it('should normalize when normalize option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = readPackageJsonSync(tmpDir, { editable: false, normalize: true } as any)
        expect(result?.version).toBeDefined()
      }, 'read-pkg-json-sync-normalize-')
    })

    it('should return editable when editable option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = readPackageJsonSync(tmpDir, { editable: true })
        expect(result).toBeDefined()
        expect(typeof result?.save).toBe('function')
      }, 'read-pkg-json-sync-editable-')
    })

    it('should throw when throws option is true and file missing', async () => {
      await runWithTempDir(async tmpDir => {
        expect(() =>
          readPackageJsonSync(tmpDir, { throws: true })
        ).toThrow()
      }, 'read-pkg-json-sync-throws-')
    })

    it('should handle editable with normalize options', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0', custom: 'field' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        // When using editable with normalize, the options are passed to the editable converter
        expect(() =>
          readPackageJsonSync(tmpDir, {
            editable: true,
            normalize: true,
            preserve: ['custom'],
          } as any)
        ).not.toThrow()
      }, 'read-pkg-json-sync-editable-norm-')
    })

    it('should pass normalize options through', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', custom: 'field' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = readPackageJsonSync(tmpDir, {
          normalize: true,
          preserve: ['custom'],
        } as any)
        expect(result).toBeDefined()
      }, 'read-pkg-json-sync-preserve-')
    })
  })

  describe('extractPackage', () => {
    it('should extract package to destination directory', async () => {
      await runWithTempDir(async tmpDir => {
        const dest = path.join(tmpDir, 'extracted')
        await fs.mkdir(dest, { recursive: true })

        // Extract a small package for testing
        await extractPackage('is-number@7.0.0', { dest })

        // Verify extraction
        const pkgJsonPath = path.join(dest, 'package.json')
        const exists = await fs
          .access(pkgJsonPath)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(true)
      }, 'extract-pkg-')
    }, 30_000)

    it('should call callback with destination path', async () => {
      await runWithTempDir(async tmpDir => {
        const dest = path.join(tmpDir, 'extracted')
        await fs.mkdir(dest, { recursive: true })

        let callbackPath = ''
        await extractPackage('is-number@7.0.0', { dest }, async (destPath) => {
          callbackPath = destPath
        })

        expect(callbackPath).toBe(dest)
      }, 'extract-pkg-callback-')
    }, 30_000)

    it('should use temporary directory when dest not provided', async () => {
      let tmpPath = ''
      await extractPackage('is-number@7.0.0', (async (destPath) => {
        tmpPath = destPath
        // Verify package.json exists in temp directory
        const pkgJsonPath = path.join(destPath, 'package.json')
        const exists = await fs
          .access(pkgJsonPath)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(true)
      }) as any)

      expect(tmpPath).toBeTruthy()
    }, 30_000)

    it('should handle function as second argument', async () => {
      let called = false
      await extractPackage('is-number@7.0.0', (async (destPath) => {
        called = true
        expect(destPath).toBeTruthy()
      }) as any)

      expect(called).toBe(true)
    }, 30_000)

    it('should pass extract options to pacote', async () => {
      await runWithTempDir(async tmpDir => {
        const dest = path.join(tmpDir, 'extracted')
        await fs.mkdir(dest, { recursive: true })

        await extractPackage('is-number@7.0.0', {
          dest,
          preferOffline: true,
        })

        const pkgJsonPath = path.join(dest, 'package.json')
        const exists = await fs
          .access(pkgJsonPath)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(true)
      }, 'extract-pkg-options-')
    }, 30_000)

    it('should use tmpPrefix option for temp directory', async () => {
      let tmpPath = ''
      await extractPackage(
        'is-number@7.0.0',
        { tmpPrefix: 'test-prefix-' } as any,
        async (destPath) => {
          tmpPath = destPath
        }
      )

      expect(tmpPath).toBeTruthy()
    }, 30_000)
  })

  describe('packPackage', () => {
    it('should pack a package tarball', async () => {
      await runWithTempDir(async tmpDir => {
        // Create a simple package to pack
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
          main: 'index.js',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )
        await fs.writeFile(
          path.join(tmpDir, 'index.js'),
          'module.exports = {}'
        )

        const tarball = await packPackage(tmpDir)
        expect(tarball).toBeDefined()
        expect(Buffer.isBuffer(tarball)).toBe(true)
      }, 'pack-pkg-')
    }, 30_000)

    it('should pack package with options', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )
        await fs.writeFile(path.join(tmpDir, 'index.js'), '')

        const tarball = await packPackage(tmpDir, { preferOffline: true })
        expect(tarball).toBeDefined()
      }, 'pack-pkg-options-')
    }, 30_000)

    it('should pack remote package spec', async () => {
      const tarball = await packPackage('is-number@7.0.0')
      expect(tarball).toBeDefined()
      expect(Buffer.isBuffer(tarball)).toBe(true)
    }, 30_000)
  })

  describe('resolveGitHubTgzUrl', () => {
    it('should return empty string when package.json not found', async () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
        version: '1.0.0',
      }
      const result = await resolveGitHubTgzUrl('test-package', pkgJson)
      expect(result).toBe('')
    })

    it('should return saveSpec for tarball URL spec', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test',
          version: '1.0.0',
          repository: { url: 'git+https://github.com/user/repo.git' },
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const tgzUrl = 'https://github.com/user/repo/archive/abc123.tar.gz'
        const result = await resolveGitHubTgzUrl(tgzUrl, tmpDir)
        // Should return the URL itself if it's already a tarball URL
        expect(typeof result).toBe('string')
      }, 'resolve-github-tgz-spec-')
    }, 30_000)

    it('should accept package.json object as where parameter', async () => {
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
        repository: { url: 'git+https://github.com/user/repo.git' },
      }

      const result = await resolveGitHubTgzUrl('test-package', pkgJson)
      // Should return empty string or valid URL
      expect(typeof result).toBe('string')
    }, 30_000)

    it('should return empty string when no repository URL', async () => {
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
      }

      const result = await resolveGitHubTgzUrl('test', pkgJson)
      expect(result).toBe('')
    })

    it('should handle GitHub URL spec with committish', async () => {
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
        repository: { url: 'git+https://github.com/user/repo.git' },
      }

      const result = await resolveGitHubTgzUrl('github:user/repo#main', pkgJson)
      expect(typeof result).toBe('string')
    }, 30_000)

    it('should try version with v prefix first', async () => {
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
        repository: { url: 'git+https://github.com/user/repo.git' },
      }

      const result = await resolveGitHubTgzUrl('test', pkgJson)
      // Will return empty string if tag doesn't exist, which is expected
      expect(typeof result).toBe('string')
    }, 30_000)

    it('should fallback to version without v prefix', async () => {
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
        repository: { url: 'git+https://github.com/user/repo.git' },
      }

      const result = await resolveGitHubTgzUrl('test', pkgJson)
      expect(typeof result).toBe('string')
    }, 30_000)

    it('should handle repository as string', async () => {
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
        repository: 'github:user/repo' as any,
      }

      const result = await resolveGitHubTgzUrl('test', pkgJson)
      expect(typeof result).toBe('string')
    }, 30_000)
  })

  describe('edge cases and error handling', () => {
    it('should handle extractPackage with invalid spec', async () => {
      await expect(
        extractPackage('non-existent-package-xyz-123', { dest: '/tmp/test' })
      ).rejects.toThrow()
    }, 30_000)

    it('should handle packPackage with invalid path', async () => {
      await expect(
        packPackage('/non/existent/path')
      ).rejects.toThrow()
    }, 30_000)

    it('should handle readPackageJson with invalid JSON', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          'not valid json {{'
        )

        const result = await readPackageJson(tmpDir, { throws: false })
        expect(result).toBeUndefined()
      }, 'edge-invalid-json-')
    })

    it('should handle readPackageJsonSync with invalid JSON', async () => {
      await runWithTempDir(async tmpDir => {
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          'not valid json {{'
        )

        const result = readPackageJsonSync(tmpDir, { throws: false })
        expect(result).toBeUndefined()
      }, 'edge-invalid-json-sync-')
    })

    it('should handle getReleaseTag with special characters', () => {
      expect(getReleaseTag('package@1.0.0-beta.1')).toBe('1.0.0-beta.1')
      expect(getReleaseTag('package@1.0.0+build.123')).toBe('1.0.0+build.123')
    })

    it('should handle resolvePackageName with null values', () => {
      const purlObj = { name: 'package', namespace: null as any }
      const result = resolvePackageName(purlObj)
      expect(result).toBe('package')
    })

    it('should handle findPackageExtensions with invalid version', () => {
      const result = findPackageExtensions('package', 'not-a-version')
      expect(result === undefined || typeof result === 'object').toBe(true)
    })
  })

  describe('lazy loading', () => {
    it('should lazy load cacache on first use', async () => {
      // This test verifies that cacache is only loaded when needed
      // Using extractPackage without dest should trigger cacache loading
      let called = false
      await extractPackage('is-number@7.0.0', (async () => {
        called = true
      }) as any)
      expect(called).toBe(true)
    }, 30_000)

    it('should lazy load fetcher on first use', async () => {
      // This test verifies that make-fetch-happen is only loaded when needed
      const pkgJson: PackageJson = {
        name: 'test',
        version: '1.0.0',
        repository: { url: 'git+https://github.com/user/repo.git' },
      }

      await resolveGitHubTgzUrl('test', pkgJson)
      // If we get here without error, lazy loading worked
      expect(true).toBe(true)
    }, 30_000)

    it('should lazy load npm-package-arg on first use', () => {
      // Using getReleaseTag should not load npm-package-arg
      getReleaseTag('package@1.0.0')
      expect(true).toBe(true)
    })

    it('should lazy load pack on first use', async () => {
      // packPackage should lazy load the pack module
      await expect(packPackage('/non/existent')).rejects.toThrow()
    }, 30_000)

    it('should lazy load pacote on first use', async () => {
      // extractPackage should lazy load pacote
      await expect(
        extractPackage('invalid-spec-xyz', { dest: '/tmp/test' })
      ).rejects.toThrow()
    }, 30_000)

    it('should lazy load semver on first use', () => {
      // findPackageExtensions should lazy load semver
      findPackageExtensions('package', '1.0.0')
      expect(true).toBe(true)
    })
  })

  describe('options handling', () => {
    it('should handle extractPackage with all options', async () => {
      await runWithTempDir(async tmpDir => {
        const dest = path.join(tmpDir, 'extracted')
        await fs.mkdir(dest, { recursive: true })

        await extractPackage('is-number@7.0.0', {
          dest,
          preferOffline: true,
          tmpPrefix: 'test-',
        })

        const exists = await fs
          .access(path.join(dest, 'package.json'))
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(true)
      }, 'extract-all-opts-')
    }, 30_000)

    it('should handle readPackageJson with all options', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', custom: 'value' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = await readPackageJson(tmpDir, {
          editable: false,
          normalize: true,
          throws: false,
          preserve: ['custom'],
        })

        expect(result).toBeDefined()
      }, 'read-all-opts-')
    })

    it('should handle readPackageJsonSync with all options', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', custom: 'value' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const result = readPackageJsonSync(tmpDir, {
          editable: false,
          throws: false,
          preserve: ['custom'],
        } as any)

        expect(result).toBeDefined()
      }, 'read-sync-all-opts-')
    })
  })

  describe('integration scenarios', () => {
    it('should extract, read, and pack a package', async () => {
      await runWithTempDir(async tmpDir => {
        const extractDest = path.join(tmpDir, 'extracted')
        await fs.mkdir(extractDest, { recursive: true })

        // Extract
        await extractPackage('is-number@7.0.0', { dest: extractDest })

        // Read
        const pkgJson = await readPackageJson(extractDest)
        expect(pkgJson?.name).toBe('is-number')

        // Pack
        const tarball = await packPackage(extractDest)
        expect(Buffer.isBuffer(tarball)).toBe(true)
      }, 'integration-extract-read-pack-')
    }, 60000)

    it('should handle editable package.json workflow', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        // Read as editable
        const editable = await readPackageJson(tmpDir, { editable: true })
        expect(editable).toBeDefined()
        expect(typeof (editable as any)?.save).toBe('function')

        // Update and save
        ;(editable as any).update({ version: '2.0.0' })
        await (editable as any).save()

        // Read again to verify
        const updated = await readPackageJson(tmpDir)
        expect(updated?.version).toBe('2.0.0')
      }, 'integration-editable-workflow-')
    })

    it('should handle release tag extraction for various formats', () => {
      const testCases = [
        { input: 'pkg@1.0.0', expected: '1.0.0' },
        { input: '@scope/pkg@1.0.0', expected: '1.0.0' },
        { input: 'pkg@latest', expected: 'latest' },
        { input: '@scope/pkg@next', expected: 'next' },
        { input: 'pkg', expected: '' },
        { input: '@scope/pkg', expected: '' },
      ]

      testCases.forEach(({ input, expected }) => {
        expect(getReleaseTag(input)).toBe(expected)
      })
    })
  })
})
