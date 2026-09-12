import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  executeSdxgenModule,
  isSdxgenDocument,
} from '../../../../src/core/sdxgen/generate.mts'

describe('sdxgen module boundary', () => {
  it.each([undefined, {}, { generateSbom: 'invalid' }])(
    'rejects malformed module %j',
    async module => {
      await expect(executeSdxgenModule(module, '.')).rejects.toThrow()
    },
  )

  it.each([
    undefined,
    {},
    { bomFormat: 'other', specVersion: '1.6' },
    { bomFormat: 'CycloneDX', specVersion: 1.6 },
    { bomFormat: 'CycloneDX', specVersion: '1.6', components: {} },
  ])('rejects malformed result %j', async result => {
    expect(isSdxgenDocument(result)).toBe(false)
    await expect(
      executeSdxgenModule({ generateSbom: () => result }, '.'),
    ).rejects.toThrow()
  })

  it('disables execution by default and preserves the document', async () => {
    const document = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      components: [{ name: 'example-dependency' }],
    }
    const generateSbom = vi.fn().mockResolvedValue(document)
    expect(await executeSdxgenModule({ generateSbom }, 'example-project')).toBe(
      document,
    )
    expect(generateSbom).toHaveBeenCalledWith(path.resolve('example-project'), {
      executeTools: false,
      format: 'cyclonedx',
    })
  })

  it('forwards explicit execution and workspace settings', async () => {
    const document = { bomFormat: 'CycloneDX', specVersion: '1.5' }
    const generateSbom = vi.fn().mockResolvedValue(document)
    await executeSdxgenModule({ generateSbom }, '.', {
      executeTools: true,
      recursive: true,
      specVersion: '1.5',
    })
    expect(generateSbom).toHaveBeenCalledWith(path.resolve('.'), {
      executeTools: true,
      recursive: true,
      specVersion: '1.5',
      format: 'cyclonedx',
    })
  })

  it('propagates parser failures', async () => {
    const failure = new Error('fixture parser failed')
    await expect(
      executeSdxgenModule({ generateSbom: () => Promise.reject(failure) }, '.'),
    ).rejects.toBe(failure)
  })
})
