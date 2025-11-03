import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCmdJson } from '../../../../src/src/handle-cmd-json.mts'

// Mock the dependencies.
vi.mock('./output-cmd-json.mts', () => ({
  outputCmdJson: vi.fn(),
}))

describe('handleCmdJson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('outputs JSON for given directory', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    await handleCmdJson('/test/project')

    expect(outputCmdJson).toHaveBeenCalledWith('/test/project')
  })

  it('handles current directory', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    await handleCmdJson('.')

    expect(outputCmdJson).toHaveBeenCalledWith('.')
  })

  it('handles absolute path', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    await handleCmdJson('/absolute/path/to/project')

    expect(outputCmdJson).toHaveBeenCalledWith('/absolute/path/to/project')
  })

  it('handles relative path', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    await handleCmdJson('../relative/path')

    expect(outputCmdJson).toHaveBeenCalledWith('../relative/path')
  })

  it('handles empty path', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    await handleCmdJson('')

    expect(outputCmdJson).toHaveBeenCalledWith('')
  })

  it('handles async errors', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    vi.mocked(outputCmdJson).mockRejectedValue(new Error('Output error'))

    await expect(handleCmdJson('/test')).rejects.toThrow('Output error')
  })

  it('is called exactly once per invocation', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    vi.mocked(outputCmdJson).mockResolvedValue(undefined)

    await handleCmdJson('/path')

    expect(outputCmdJson).toHaveBeenCalledTimes(1)
  })

  it('handles Windows-style paths', async () => {
    const { outputCmdJson } = await import('../../src/output-cmd-json.mts')

    vi.mocked(outputCmdJson).mockResolvedValue(undefined)

    await handleCmdJson('C:\\Users\\test\\project')

    expect(outputCmdJson).toHaveBeenCalledWith('C:\\Users\\test\\project')
  })
})
