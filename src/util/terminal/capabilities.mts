import process from 'node:process'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { colorsToAnsi } from '@socketsecurity/lib-stable/term/effects/shimmer-terminal'

import type { RGB } from '@socketsecurity/lib-stable/term/effects/shimmer'

export interface TerminalColorBinding {
  setFgRgb(red: number, green: number, blue: number): string
}

export interface TerminalCapabilities {
  mode: 'native' | 'ansi' | 'plain'
  truecolor: boolean
  binding?: TerminalColorBinding | undefined
}

export interface TerminalCapabilityInput {
  isTTY: boolean
  noColor?: string | undefined
  term?: string | undefined
  colorterm?: string | undefined
  termProgram?: string | undefined
  binding?: unknown | undefined
}

export function getTerminalCapabilities(): TerminalCapabilities {
  return resolveTerminalCapabilities({
    isTTY: process.stderr.isTTY === true,
    noColor: getEnvValue('NO_COLOR'),
    term: getEnvValue('TERM'),
    colorterm: getEnvValue('COLORTERM'),
    termProgram: getEnvValue('TERM_PROGRAM'),
    binding: process.getBuiltinModule('node:smol-tui'),
  })
}

export function isTerminalColorBinding(
  binding: unknown,
): binding is TerminalColorBinding {
  return (
    typeof binding === 'object' &&
    binding !== null &&
    'setFgRgb' in binding &&
    typeof binding.setFgRgb === 'function'
  )
}

export function renderTerminalColors(
  text: string,
  colors: readonly RGB[],
  capabilities: TerminalCapabilities,
): string {
  if (capabilities.mode === 'plain') {
    return text
  }
  const { binding } = capabilities
  if (capabilities.mode !== 'native' || !binding) {
    return colorsToAnsi(text, colors)
  }
  return [...text]
    .map((character, index) => {
      const color = colors[index]
      return color
        ? `${binding.setFgRgb(...color)}${character}\x1b[0m`
        : character
    })
    .join('')
}

export function resolveTerminalCapabilities(
  input: TerminalCapabilityInput,
): TerminalCapabilities {
  if (!input.isTTY || input.noColor !== undefined || input.term === 'dumb') {
    return { mode: 'plain', truecolor: false }
  }
  const truecolor =
    ['truecolor', '24bit'].includes(input.colorterm ?? '') ||
    input.term?.includes('24bit') === true ||
    input.term?.includes('truecolor') === true ||
    ['iTerm.app', 'Hyper', 'vscode'].includes(input.termProgram ?? '')
  const { binding } = input
  if (truecolor && isTerminalColorBinding(binding)) {
    return { mode: 'native', truecolor, binding }
  }
  return { mode: 'ansi', truecolor }
}
