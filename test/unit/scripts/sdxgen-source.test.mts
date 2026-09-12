import { beforeEach, expect, it, vi } from 'vitest'
import { ensureSdxgenSource } from '../../../scripts/repo/cli-build/sdxgen.mts'

const spawn = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn,
}))

beforeEach(() => {
  spawn.mockReset()
})

it('hydrates missing source through the fleet helper and checks its pin', async () => {
  spawn
    .mockResolvedValueOnce({ code: 0 })
    .mockResolvedValueOnce({ code: 0 })
    .mockResolvedValueOnce({ code: 0, stdout: 'fixture-pin\n' })
    .mockResolvedValueOnce({ code: 0, stdout: 'fixture-pin\n' })
    .mockResolvedValueOnce({ code: 0 })
  await ensureSdxgenSource(
    '/example-checkout',
    '/example-checkout/upstream/sdxgen',
  )
  expect(spawn.mock.calls[0]![1]).toEqual([
    '/example-checkout/scripts/fleet/git-partial-submodule.mts',
    'clone',
    'upstream/sdxgen',
  ])
  expect(spawn).toHaveBeenCalledTimes(5)
})

it('stops if hydration fails', async () => {
  spawn.mockResolvedValue({ code: 1 })
  await expect(
    ensureSdxgenSource(
      '/example-checkout',
      '/example-checkout/upstream/sdxgen',
    ),
  ).rejects.toThrow()
  expect(spawn).toHaveBeenCalledOnce()
})

it.each([
  [{ code: 1, stdout: '' }, { code: 0, stdout: 'fixture-pin' }, { code: 0 }],
  [{ code: 0, stdout: 'fixture-pin' }, { code: 1, stdout: '' }, { code: 0 }],
  [
    { code: 0, stdout: 'fixture-pin' },
    { code: 0, stdout: 'different-pin' },
    { code: 0 },
  ],
  [
    { code: 0, stdout: 'fixture-pin' },
    { code: 0, stdout: 'fixture-pin' },
    { code: 1 },
  ],
])('rejects mismatched or modified source', async (pin, head, clean) => {
  spawn
    .mockResolvedValueOnce({ code: 0 })
    .mockResolvedValueOnce({ code: 0 })
    .mockResolvedValueOnce(pin)
    .mockResolvedValueOnce(head)
    .mockResolvedValueOnce(clean)
  await expect(
    ensureSdxgenSource(
      '/example-checkout',
      '/example-checkout/upstream/sdxgen',
    ),
  ).rejects.toThrow()
})

it('stops if sparse assets cannot be restored', async () => {
  spawn.mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1 })
  await expect(
    ensureSdxgenSource(
      '/example-checkout',
      '/example-checkout/upstream/sdxgen',
    ),
  ).rejects.toThrow()
  expect(spawn).toHaveBeenCalledTimes(2)
})
