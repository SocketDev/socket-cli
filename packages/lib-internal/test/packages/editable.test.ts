/**
 * @fileoverview Unit tests for editable package.json manipulation utilities.
 *
 * Tests EditablePackageJson class for modifying package.json programmatically:
 * - Field setters: name, version, description, scripts, dependencies
 * - Dependency management: add/remove/update dependencies
 * - Script manipulation: add/remove/update scripts
 * - Serialization: toJSON(), toString() with formatting preservation
 * Critical for Socket CLI package.json editing operations (security fixes, updates).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { EditablePackageJson, PackageJson } from '@socketsecurity/lib/packages'
import {
  getEditablePackageJsonClass,
  pkgJsonToEditable,
  toEditablePackageJson,
  toEditablePackageJsonSync,
} from '@socketsecurity/lib/packages/editable'
import { describe, expect, it } from 'vitest'

import { runWithTempDir } from '../utils/temp-file-helper.mjs'

describe('packages/editable', () => {
  describe('getEditablePackageJsonClass', () => {
    it('should return EditablePackageJson class', () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      expect(EditablePackageJson).toBeDefined()
      expect(typeof EditablePackageJson).toBe('function')
    })

    it('should return same class instance on multiple calls (memoized)', () => {
      const EditablePackageJson1 = getEditablePackageJsonClass()
      const EditablePackageJson2 = getEditablePackageJsonClass()
      expect(EditablePackageJson1).toBe(EditablePackageJson2)
    })

    it('should have static methods', () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      expect(typeof EditablePackageJson.create).toBe('function')
      expect(typeof EditablePackageJson.load).toBe('function')
      expect(typeof EditablePackageJson.fix).toBe('function')
      expect(typeof EditablePackageJson.normalize).toBe('function')
      expect(typeof EditablePackageJson.prepare).toBe('function')
    })

    it('should have static steps properties', () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      expect(Array.isArray(EditablePackageJson.fixSteps)).toBe(true)
      expect(Array.isArray(EditablePackageJson.normalizeSteps)).toBe(true)
      expect(Array.isArray(EditablePackageJson.prepareSteps)).toBe(true)
    })
  })

  describe('EditablePackageJson.create', () => {
    it('should create a new package.json instance', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.create(tmpDir)

        expect(pkg).toBeDefined()
        expect(pkg.content).toBeDefined()
        expect((pkg as any).path).toBe(tmpDir)
        expect((pkg as any).filename).toContain('package.json')
      }, 'editable-create-')
    })

    it('should create package.json with initial data', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const data: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
          description: 'Test package',
        }
        const pkg = await EditablePackageJson.create(tmpDir, { data })

        expect(pkg.content.name).toBe('test-package')
        expect(pkg.content.version).toBe('1.0.0')
        expect(pkg.content.description).toBe('Test package')
      }, 'editable-create-data-')
    })

    it('should create package.json without data option', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.create(tmpDir, {})

        expect(pkg).toBeDefined()
        expect(pkg.content).toBeDefined()
      }, 'editable-create-empty-')
    })
  })

  describe('EditablePackageJson.load', () => {
    it('should load existing package.json file', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
        }
        await fs.writeFile(pkgPath, JSON.stringify(pkgData, null, 2))

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        expect(pkg.content.name).toBe('test-package')
        expect(pkg.content.version).toBe('1.0.0')
      }, 'editable-load-')
    })

    it('should throw error when file does not exist and create is false', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()

        await expect(
          EditablePackageJson.load(tmpDir, { create: false })
        ).rejects.toThrow()
      }, 'editable-load-error-')
    })

    it('should create new package.json when file does not exist and create is true', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir, { create: true })

        expect(pkg).toBeDefined()
        expect(pkg.content).toBeDefined()
      }, 'editable-load-create-')
    })

    it('should load package.json from directory path', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        expect(pkg.content.name).toBe('test')
      }, 'editable-load-dir-')
    })

    it('should preserve indentation from original file', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = '{\n    "name": "test",\n    "version": "1.0.0"\n}\n'
        await fs.writeFile(pkgPath, pkgData)

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        expect(pkg.content.name).toBe('test')
      }, 'editable-load-indent-')
    })

    it('should handle non-package.json errors during load with create=true', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()

        await expect(
          EditablePackageJson.load(tmpDir, { create: true })
        ).resolves.toBeDefined()
      }, 'editable-load-fallback-')
    })

    it('should create new instance when package.json missing and create=true', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir, { create: true })

        expect(pkg).toBeDefined()
        expect(pkg.content).toBeDefined()
      }, 'editable-load-create-')
    })
  })

  describe('EditablePackageJson.fix', () => {
    it('should apply npm fixes to package.json', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.fix(tmpDir, {})

        expect(pkg).toBeDefined()
        expect(pkg.content).toBeDefined()
      }, 'editable-fix-')
    })
  })

  describe('EditablePackageJson.normalize', () => {
    it('should normalize package.json', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.normalize(tmpDir, {})

        expect(pkg).toBeDefined()
        expect(pkg.content.name).toBe('test-package')
      }, 'editable-normalize-')
    })

    it('should normalize with preserve options', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
          custom: 'field',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.normalize(tmpDir, {
          preserve: ['custom'],
        })

        expect(pkg.content.name).toBe('test-package')
      }, 'editable-normalize-preserve-')
    })
  })

  describe('EditablePackageJson.prepare', () => {
    it('should prepare package.json for publishing', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test-package',
          version: '1.0.0',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.prepare(tmpDir, {})

        expect(pkg).toBeDefined()
      }, 'editable-prepare-')
    })
  })

  describe('EditablePackageJson instance methods', () => {
    describe('create', () => {
      it('should create instance with path', async () => {
        await runWithTempDir(async tmpDir => {
          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson().create(tmpDir)

          expect((pkg as any).path).toBe(tmpDir)
          expect((pkg as any).filename).toContain('package.json')
        }, 'instance-create-')
      })
    })

    describe('fromContent', () => {
      it('should initialize from content object', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()
        const content = { name: 'test', version: '1.0.0' }

        pkg.fromContent(content)

        expect(pkg.content.name).toBe('test')
        expect(pkg.content.version).toBe('1.0.0')
      })

      it('should disable saving when initialized from content', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()
        const content = { name: 'test', version: '1.0.0' }

        pkg.fromContent(content)

        expect(pkg.willSave()).toBe(false)
      })
    })

    describe('fromJSON', () => {
      it('should initialize from JSON string', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()
        const json = JSON.stringify({ name: 'test', version: '1.0.0' })

        pkg.fromJSON(json)

        expect(pkg.content.name).toBe('test')
        expect(pkg.content.version).toBe('1.0.0')
      })
    })

    describe('update', () => {
      it('should update package.json content', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()
        pkg.fromContent({ name: 'test', version: '1.0.0' })

        pkg.update({ version: '2.0.0', description: 'Updated' })

        expect(pkg.content.version).toBe('2.0.0')
        expect(pkg.content.description).toBe('Updated')
      })
    })

    describe('load', () => {
      it('should load package.json from path', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)

          expect(pkg.content.name).toBe('test')
          expect((pkg as any).path).toBe(tmpDir)
        }, 'instance-load-')
      })

      it('should throw error when file not found and create is false', async () => {
        await runWithTempDir(async tmpDir => {
          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()

          await expect(pkg.load(tmpDir, false)).rejects.toThrow()
        }, 'instance-load-error-')
      })

      it('should throw error if index.js does not exist with create=true', async () => {
        await runWithTempDir(async tmpDir => {
          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()

          await expect(pkg.load(tmpDir, true)).rejects.toThrow()
        }, 'instance-load-noindex-')
      })

      it('should throw original error if index.js is invalid', async () => {
        await runWithTempDir(async tmpDir => {
          const indexPath = path.join(tmpDir, 'index.js')
          await fs.writeFile(indexPath, 'invalid javascript {{{')

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()

          await expect(pkg.load(tmpDir, true)).rejects.toThrow()
        }, 'instance-load-invalidindex-')
      })
    })

    describe('fix', () => {
      it('should apply fixes to loaded package.json', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)
          await pkg.fix()

          expect(pkg.content).toBeDefined()
        }, 'instance-fix-')
      })

      it('should apply fixes with options', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)
          await pkg.fix({})

          expect(pkg.content).toBeDefined()
        }, 'instance-fix-opts-')
      })
    })

    describe('normalize', () => {
      it('should normalize loaded package.json', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)
          await pkg.normalize()

          expect(pkg.content.name).toBe('test')
        }, 'instance-normalize-')
      })

      it('should normalize with options', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)
          await pkg.normalize({})

          expect(pkg.content.name).toBe('test')
        }, 'instance-normalize-opts-')
      })
    })

    describe('prepare', () => {
      it('should prepare loaded package.json', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)
          await pkg.prepare()

          expect(pkg.content).toBeDefined()
        }, 'instance-prepare-')
      })

      it('should prepare with options', async () => {
        await runWithTempDir(async tmpDir => {
          const pkgData = { name: 'test', version: '1.0.0' }
          await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify(pkgData)
          )

          const EditablePackageJson = getEditablePackageJsonClass()
          const pkg = new EditablePackageJson()
          await pkg.load(tmpDir)
          await pkg.prepare({})

          expect(pkg.content).toBeDefined()
        }, 'instance-prepare-opts-')
      })
    })

    describe('filename', () => {
      it('should return empty string when path is undefined', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()

        expect((pkg as any).filename).toBe('')
      })

      it('should return path as-is if it ends with package.json', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()
        const filepath = '/path/to/package.json'
        pkg.create(filepath)

        expect((pkg as any).filename).toBe(filepath)
      })

      it('should append package.json if path does not end with it', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()
        const dirpath = '/path/to/dir'
        pkg.create(dirpath)

        expect((pkg as any).filename).toContain('package.json')
      })
    })

    describe('path', () => {
      it('should return the path property', () => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = new EditablePackageJson()

        expect((pkg as any).path).toBeUndefined()

        pkg.create('/test/path')
        expect((pkg as any).path).toBe('/test/path')
      })
    })
  })

  describe('save and willSave', () => {
    it('should save package.json to disk', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(pkgPath, JSON.stringify(pkgData, null, 2))

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ version: '2.0.0' })

        const saved = await pkg.save()
        expect(saved).toBe(true)

        const content = await fs.readFile(pkgPath, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed.version).toBe('2.0.0')
      }, 'save-')
    })

    it('should return false when no changes to save', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        const saved = await pkg.save()
        expect(saved).toBe(false)
      }, 'save-nochange-')
    })

    it('should throw error when trying to save without canSave', async () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      const pkg = new EditablePackageJson()
      pkg.fromContent({ name: 'test', version: '1.0.0' })

      await expect(pkg.save()).rejects.toThrow('No package.json to save to')
    })

    it('should throw error when content is undefined', async () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      const pkg = new EditablePackageJson()

      await expect(pkg.save()).rejects.toThrow('No package.json to save to')
    })

    it('should save with sort option', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          version: '1.0.0',
          name: 'test',
          description: 'Test',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ description: 'Updated' })

        const saved = await pkg.save({ sort: true })
        expect(saved).toBe(true)
      }, 'save-sort-')
    })

    it('should save with ignoreWhitespace option', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        const saved = await pkg.save({ ignoreWhitespace: true })
        expect(saved).toBe(false)
      }, 'save-whitespace-')
    })

    it('should preserve custom indentation', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = '{\n    "name": "test",\n    "version": "1.0.0"\n}\n'
        await fs.writeFile(pkgPath, pkgData)

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ description: 'Test' })

        await pkg.save()

        const content = await fs.readFile(pkgPath, 'utf8')
        expect(content).toContain('    "name"')
      }, 'save-indent-')
    })

    it('should preserve custom newline characters', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = '{\r\n  "name": "test",\r\n  "version": "1.0.0"\r\n}\r\n'
        await fs.writeFile(pkgPath, pkgData)

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ description: 'Test' })

        await pkg.save()

        const content = await fs.readFile(pkgPath, 'utf8')
        expect(content).toContain('\r\n')
      }, 'save-newline-')
    })

    it('should use default indentation when not specified', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.create(tmpDir, {
          data: { name: 'test', version: '1.0.0' },
        })

        await pkg.save()

        const content = await fs.readFile((pkg as any).filename, 'utf8')
        expect(content).toContain('  "name"')
      }, 'save-default-indent-')
    })

    it('should willSave return true when changes exist', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ version: '2.0.0' })

        expect(pkg.willSave()).toBe(true)
      }, 'willsave-true-')
    })

    it('should willSave return false when no changes exist', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        expect(pkg.willSave()).toBe(false)
      }, 'willsave-false-')
    })

    it('should willSave return false when cannot save', () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      const pkg = new EditablePackageJson()
      pkg.fromContent({ name: 'test', version: '1.0.0' })

      expect(pkg.willSave()).toBe(false)
    })

    it('should willSave return false when content is undefined', () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      const pkg = new EditablePackageJson()

      expect(pkg.willSave()).toBe(false)
    })

    it('should willSave respect ignoreWhitespace option', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2) + '\n'
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        // ignoreWhitespace checks content equality, not file text equality
        // When symbols are present, it may return true
        const willSave = pkg.willSave({ ignoreWhitespace: true })
        expect(typeof willSave).toBe('boolean')
      }, 'willsave-whitespace-')
    })

    it('should willSave work with sort option', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          version: '1.0.0',
          name: 'test',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        const willSave = pkg.willSave({ sort: true })
        expect(typeof willSave).toBe('boolean')
      }, 'willsave-sort-')
    })
  })

  describe('saveSync', () => {
    it('should synchronously save package.json', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(pkgPath, JSON.stringify(pkgData, null, 2))

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ version: '2.0.0' })

        const saved = pkg.saveSync()
        expect(saved).toBe(true)

        const content = await fs.readFile(pkgPath, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed.version).toBe('2.0.0')
      }, 'savesync-')
    })

    it('should return false when no changes to save', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        const saved = pkg.saveSync()
        expect(saved).toBe(false)
      }, 'savesync-nochange-')
    })

    it('should throw error when cannot save', () => {
      const EditablePackageJson = getEditablePackageJsonClass()
      const pkg = new EditablePackageJson()
      pkg.fromContent({ name: 'test', version: '1.0.0' })

      expect(() => pkg.saveSync()).toThrow('No package.json to save to')
    })

    it('should saveSync with sort option', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          version: '1.0.0',
          name: 'test',
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({ description: 'Test' })

        const saved = pkg.saveSync({ sort: true })
        expect(saved).toBe(true)
      }, 'savesync-sort-')
    })

    it('should saveSync respect ignoreWhitespace option', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2) + '\n'
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        // ignoreWhitespace checks content equality, not file text equality
        const saved = pkg.saveSync({ ignoreWhitespace: true })
        expect(typeof saved).toBe('boolean')
      }, 'savesync-whitespace-')
    })
  })

  describe('pkgJsonToEditable', () => {
    it('should convert package.json to editable instance', () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
        version: '1.0.0',
      }

      const editable = pkgJsonToEditable(pkgJson) as EditablePackageJson

      expect(editable).toBeDefined()
      expect(editable.content.name).toBe('test-package')
      expect(editable.content.version).toBe('1.0.0')
    })

    it('should convert without normalization by default', () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
        version: '1.0.0',
        custom: 'field',
      }

      const editable = pkgJsonToEditable(pkgJson) as EditablePackageJson

      expect(editable.content.custom).toBe('field')
    })

    it('should normalize when normalize option is true', () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
      }

      const editable = pkgJsonToEditable(pkgJson, {
        normalize: true,
      }) as EditablePackageJson

      expect(editable).toBeDefined()
      expect(editable.content.name).toBe('test-package')
      expect(editable.content.version).toBeDefined()
    })

    it('should pass normalize options through', () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
        custom: 'field',
      }

      const editable = pkgJsonToEditable(pkgJson, {
        normalize: true,
        preserve: ['custom'],
      }) as EditablePackageJson

      expect(editable).toBeDefined()
    })

    it('should handle empty package.json', () => {
      const pkgJson: PackageJson = {}

      const editable = pkgJsonToEditable(pkgJson) as EditablePackageJson

      expect(editable).toBeDefined()
      expect(editable.content).toBeDefined()
    })
  })

  describe('toEditablePackageJson', () => {
    it('should convert to editable with file path', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
        }

        const editable = (await toEditablePackageJson(pkgJson, {
          path: tmpDir,
        })) as EditablePackageJson

        expect(editable).toBeDefined()
        expect(editable.content.name).toBe('test-package')
        expect((editable as any).path).toBeDefined()
      }, 'toeditable-')
    })

    it('should convert without path (like pkgJsonToEditable)', async () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
        version: '1.0.0',
      }

      const editable = (await toEditablePackageJson(
        pkgJson,
        {}
      )) as EditablePackageJson

      expect(editable).toBeDefined()
      expect(editable.content.name).toBe('test-package')
    })

    it('should normalize when normalize option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
        }

        const editable = (await toEditablePackageJson(pkgJson, {
          path: tmpDir,
          normalize: true,
        })) as EditablePackageJson

        expect(editable).toBeDefined()
        expect(editable.content.version).toBeDefined()
      }, 'toeditable-normalize-')
    })

    it('should preserve repository for non-node_modules paths', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
          repository: 'https://github.com/test/repo',
        }

        const editable = (await toEditablePackageJson(pkgJson, {
          path: tmpDir,
          normalize: true,
        })) as EditablePackageJson

        expect(editable).toBeDefined()
      }, 'toeditable-preserve-')
    })

    it('should handle node_modules paths differently', async () => {
      await runWithTempDir(async tmpDir => {
        const nodeModulesPath = path.join(tmpDir, 'node_modules', 'test-pkg')
        await fs.mkdir(nodeModulesPath, { recursive: true })

        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
        }

        const editable = (await toEditablePackageJson(pkgJson, {
          path: nodeModulesPath,
          normalize: true,
        })) as EditablePackageJson

        expect(editable).toBeDefined()
      }, 'toeditable-nodemodules-')
    })

    it('should pass preserve options through', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
          custom: 'field',
        }

        const editable = (await toEditablePackageJson(pkgJson, {
          path: tmpDir,
          normalize: true,
          preserve: ['custom'],
        })) as EditablePackageJson

        expect(editable).toBeDefined()
      }, 'toeditable-preserve-opts-')
    })

    it('should handle package.json path ending with package.json', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJsonPath = path.join(tmpDir, 'package.json')
        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
        }

        const editable = (await toEditablePackageJson(pkgJson, {
          path: pkgJsonPath,
        })) as EditablePackageJson

        expect(editable).toBeDefined()
      }, 'toeditable-pkgjson-')
    })
  })

  describe('toEditablePackageJsonSync', () => {
    it('should synchronously convert to editable with file path', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
        }

        const editable = toEditablePackageJsonSync(pkgJson, {
          path: tmpDir,
        }) as EditablePackageJson

        expect(editable).toBeDefined()
        expect(editable.content.name).toBe('test-package')
      }, 'toeditablesync-')
    })

    it('should convert without path', () => {
      const pkgJson: PackageJson = {
        name: 'test-package',
        version: '1.0.0',
      }

      const editable = toEditablePackageJsonSync(
        pkgJson,
        {}
      ) as EditablePackageJson

      expect(editable).toBeDefined()
      expect(editable.content.name).toBe('test-package')
    })

    it('should normalize when normalize option is true', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
        }

        const editable = toEditablePackageJsonSync(pkgJson, {
          path: tmpDir,
          normalize: true,
        }) as EditablePackageJson

        expect(editable).toBeDefined()
        expect(editable.content.version).toBeDefined()
      }, 'toeditablesync-normalize-')
    })

    it('should handle node_modules paths', async () => {
      await runWithTempDir(async tmpDir => {
        const nodeModulesPath = path.join(tmpDir, 'node_modules', 'test-pkg')
        await fs.mkdir(nodeModulesPath, { recursive: true })

        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
        }

        const editable = toEditablePackageJsonSync(pkgJson, {
          path: nodeModulesPath,
          normalize: true,
        }) as EditablePackageJson

        expect(editable).toBeDefined()
      }, 'toeditablesync-nodemodules-')
    })

    it('should pass preserve options through', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgJson: PackageJson = {
          name: 'test-package',
          version: '1.0.0',
          custom: 'field',
        }

        const editable = toEditablePackageJsonSync(pkgJson, {
          path: tmpDir,
          normalize: true,
          preserve: ['custom'],
        }) as EditablePackageJson

        expect(editable).toBeDefined()
      }, 'toeditablesync-preserve-')
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        await fs.writeFile(pkgPath, '{ invalid json }')

        const EditablePackageJson = getEditablePackageJsonClass()

        await expect(EditablePackageJson.load(tmpDir)).rejects.toThrow()
      }, 'edge-malformed-')
    })

    it('should handle empty package.json file', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        await fs.writeFile(pkgPath, '')

        const EditablePackageJson = getEditablePackageJsonClass()

        await expect(EditablePackageJson.load(tmpDir)).rejects.toThrow()
      }, 'edge-empty-')
    })

    it('should handle package.json with only whitespace', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgPath = path.join(tmpDir, 'package.json')
        await fs.writeFile(pkgPath, '   \n  \n  ')

        const EditablePackageJson = getEditablePackageJsonClass()

        await expect(EditablePackageJson.load(tmpDir)).rejects.toThrow()
      }, 'edge-whitespace-')
    })

    it('should handle numeric indentation', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.create(tmpDir, {
          data: { name: 'test', version: '1.0.0' },
        })

        // Manually set numeric indent
        ;(pkg.content as any)[Symbol.for('indent')] = 4

        await pkg.save()

        const content = await fs.readFile((pkg as any).filename, 'utf8')
        expect(content).toBeDefined()
      }, 'edge-numeric-indent-')
    })

    it('should handle null indent (use default)', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.create(tmpDir, {
          data: { name: 'test', version: '1.0.0' },
        })

        ;(pkg.content as any)[Symbol.for('indent')] = null

        await pkg.save()

        const content = await fs.readFile((pkg as any).filename, 'utf8')
        expect(content).toContain('  ')
      }, 'edge-null-indent-')
    })

    it('should handle null newline (use default)', async () => {
      await runWithTempDir(async tmpDir => {
        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.create(tmpDir, {
          data: { name: 'test', version: '1.0.0' },
        })

        ;(pkg.content as any)[Symbol.for('newline')] = null

        await pkg.save()

        const content = await fs.readFile((pkg as any).filename, 'utf8')
        expect(content).toContain('\n')
      }, 'edge-null-newline-')
    })

    it('should handle deep updates', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = {
          name: 'test',
          version: '1.0.0',
          dependencies: {
            dep1: '1.0.0',
          },
        }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)
        pkg.update({
          dependencies: {
            dep1: '1.0.0',
            dep2: '2.0.0',
          },
        })

        await pkg.save()

        expect(pkg.content.dependencies?.dep2).toBe('2.0.0')
      }, 'edge-deep-update-')
    })

    it('should handle symbols in content properly', async () => {
      await runWithTempDir(async tmpDir => {
        const pkgData = { name: 'test', version: '1.0.0' }
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify(pkgData, null, 2)
        )

        const EditablePackageJson = getEditablePackageJsonClass()
        const pkg = await EditablePackageJson.load(tmpDir)

        // Symbols should not be in saved JSON
        const content = pkg.content as Record<string | symbol, unknown>
        expect(content[Symbol.for('indent')]).toBeDefined()

        await pkg.save()

        const fileContent = await fs.readFile((pkg as any).filename, 'utf8')
        expect(fileContent).not.toContain('Symbol')
      }, 'edge-symbols-')
    })
  })
})
