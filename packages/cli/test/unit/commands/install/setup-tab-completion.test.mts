/**
 * Unit tests for setupTabCompletion.
 *
 * Sets up bash tab completion: writes the completion script to its install
 * target (creating the parent dir when needed) and appends a source line
 * to ~/.bashrc when one isn't already present.
 *
 * Related Files:
 * - src/commands/install/setup-tab-completion.mts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())
const mockAppendFileSync = vi.hoisted(() => vi.fn())
const mockWriteFileSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  appendFileSync: mockAppendFileSync,
  writeFileSync: mockWriteFileSync,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    appendFileSync: mockAppendFileSync,
    writeFileSync: mockWriteFileSync,
  },
}))

const mockSafeMkdirSync = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/fs', () => ({
  safeMkdirSync: mockSafeMkdirSync,
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
}))

const mockGetBashrcDetails = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/util/cli/completion.mts', () => ({
  getBashrcDetails: mockGetBashrcDetails,
}))

const mockGetCliVersionHash = vi.hoisted(() => vi.fn(() => 'v1.2.3'))
vi.mock('../../../../src/env/cli-version-hash.mts', () => ({
  getCliVersionHash: mockGetCliVersionHash,
}))

vi.mock('../../../../src/constants/paths.mts', () => ({
  homePath: '/home/user',
}))

import {
  setupTabCompletion,
  updateInstalledTabCompletionScript,
} from '../../../../src/commands/install/setup-tab-completion.mts'

describe('setupTabCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBashrcDetails.mockReturnValue({
      ok: true,
      data: {
        completionCommand: 'complete -F _socket_complete socket',
        sourcingCommand: 'source ~/.local/share/socket/completion.bash',
        targetPath: '/home/user/.local/share/socket/completion.bash',
        toAddToBashrc: '\n# Socket completion\nsource ...\n',
      },
    })
    // Default: target dir exists, source script exists.
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('completion script content')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when getBashrcDetails fails', async () => {
    mockGetBashrcDetails.mockReturnValueOnce({
      ok: false,
      message: 'Unsupported shell',
    })

    const result = await setupTabCompletion('socket')

    expect(result.ok).toBe(false)
  })

  it('creates target dir when it does not exist', async () => {
    mockExistsSync.mockImplementation(
      (p: string) => p !== '/home/user/.local/share/socket',
    )

    await setupTabCompletion('socket')

    expect(mockSafeMkdirSync).toHaveBeenCalledWith(
      '/home/user/.local/share/socket',
      { recursive: true },
    )
  })

  it('appends sourcing line to .bashrc when missing', async () => {
    mockReadFileSync.mockReturnValueOnce('completion script content')
    mockReadFileSync.mockReturnValueOnce('# unrelated bashrc')

    const result = await setupTabCompletion('socket')

    expect(mockAppendFileSync).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.bashrcUpdated).toBe(true)
    }
  })

  it('does not re-append when sourcing line is already present', async () => {
    // First read: completion script (for write).
    // Second read: bashrc that already contains the sourcing line.
    mockReadFileSync.mockReturnValueOnce('completion script content')
    mockReadFileSync.mockReturnValueOnce(
      'source ~/.local/share/socket/completion.bash\n',
    )

    const result = await setupTabCompletion('socket')

    expect(mockAppendFileSync).not.toHaveBeenCalled()
    if (result.ok) {
      expect(result.data.bashrcUpdated).toBe(false)
      expect(result.data.foundBashrc).toBe(true)
    }
  })

  it('handles missing .bashrc gracefully', async () => {
    mockExistsSync.mockImplementation(
      (p: string) =>
        // Source script + target dir exist, .bashrc does not.
        !p.endsWith('.bashrc'),
    )

    const result = await setupTabCompletion('socket')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.foundBashrc).toBe(false)
      expect(result.data.bashrcUpdated).toBe(false)
    }
  })

  it('swallows readFileSync errors on .bashrc (deleted between checks)', async () => {
    // First read for completion script.
    mockReadFileSync.mockReturnValueOnce('completion script content')
    // Second read (.bashrc) throws.
    mockReadFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await setupTabCompletion('socket')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.bashrcUpdated).toBe(false)
    }
  })
})

describe('updateInstalledTabCompletionScript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('VERSION=%SOCKET_VERSION_TOKEN%')
  })

  it('writes the completion script with version token replaced', () => {
    const result = updateInstalledTabCompletionScript('/target/completion.bash')

    expect(result.ok).toBe(true)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/target/completion.bash',
      'VERSION=v1.2.3',
      'utf8',
    )
  })

  it('returns error when source completion script is missing', () => {
    mockExistsSync.mockReturnValue(false)

    const result = updateInstalledTabCompletionScript('/target/completion.bash')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Source not found')
    }
  })
})
