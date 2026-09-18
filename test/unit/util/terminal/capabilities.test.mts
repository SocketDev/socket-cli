import { describe, expect, it, vi } from 'vitest'

import {
  renderTerminalColors,
  resolveTerminalCapabilities,
} from '../../../../src/util/terminal/capabilities.mts'

const color = [12, 34, 56] as const

function createTerminalBinding() {
  return {
    setFgRgb: vi.fn(
      (red: number, green: number, blue: number) =>
        `\x1b[38;2;${red};${green};${blue}m`,
    ),
  }
}

describe('terminal capabilities', () => {
  it.each([
    { isTTY: false, colorterm: 'truecolor' },
    { isTTY: true, noColor: '' },
    { isTTY: true, noColor: '1' },
    { isTTY: true, term: 'dumb' },
  ])('keeps non-color output plain: %j', input => {
    const binding = createTerminalBinding()
    const capabilities = resolveTerminalCapabilities({ ...input, binding })
    expect(capabilities.mode).toBe('plain')
    const output = renderTerminalColors('Socket', [color], capabilities)
    expect(output).toBe('Socket')
    expect(binding.setFgRgb).not.toHaveBeenCalled()
  })

  it.each([undefined, {}, { setFgRgb: false }])(
    'renders ANSI when the native binding is unavailable: %j',
    binding => {
      const capabilities = resolveTerminalCapabilities({
        isTTY: true,
        colorterm: 'truecolor',
        binding,
      })
      expect(capabilities.mode).toBe('ansi')
      const output = renderTerminalColors('S', [color], capabilities)
      expect(output).toBe('\x1b[38;2;12;34;56mS\x1b[0m')
    },
  )

  it('uses the embedded stuie color binding for rich output', () => {
    const binding = createTerminalBinding()
    const capabilities = resolveTerminalCapabilities({
      isTTY: true,
      colorterm: 'truecolor',
      binding,
    })
    expect(capabilities.mode).toBe('native')
    const output = renderTerminalColors('Socket', [color], capabilities)
    expect(output).toBe('\x1b[38;2;12;34;56mS\x1b[0mocket')
    expect(binding.setFgRgb).toHaveBeenCalledWith(12, 34, 56)
    expect(binding.setFgRgb).toHaveBeenCalledTimes(1)
  })

  it('preserves Unicode code points across native and ANSI rendering', () => {
    const input = { isTTY: true, colorterm: 'truecolor' }
    const native = resolveTerminalCapabilities({
      ...input,
      binding: createTerminalBinding(),
    })
    const ansi = resolveTerminalCapabilities(input)
    const nativeOutput = renderTerminalColors('𐀀 socket', [color], native)
    const ansiOutput = renderTerminalColors('𐀀 socket', [color], ansi)
    expect(nativeOutput).toBe(ansiOutput)
  })

  it('does not select native truecolor on a basic terminal', () => {
    const capabilities = resolveTerminalCapabilities({
      isTTY: true,
      term: 'xterm',
      binding: createTerminalBinding(),
    })
    expect(capabilities).toEqual({ mode: 'ansi', truecolor: false })
  })
})
