/*
 * Spinner compatibility helpers adapted from @socketsecurity/registry 1.1.17
 * (lib/spinner.js) and @socketregistry/yocto-spinner 1.0.23.
 * Copyright (c) 2024 Socket Inc. Both sources are licensed under MIT.
 */

import process from 'node:process'

export type SpinnerStyle = { frames: string[]; interval?: number | undefined }
export type SpinnerOptions = {
  color?: string | undefined
  spinner?: SpinnerStyle | undefined
  signal?: AbortSignal | undefined
  stream?: NodeJS.WriteStream | undefined
  text?: string | undefined
}

const ciSpinner: SpinnerStyle = { frames: [''], interval: 2_147_483_647 }
const defaultStyle: SpinnerStyle = {
  frames:
    process.env['TERM'] === 'linux'
      ? ['-', '\\', '|', '/']
      : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  interval: 80,
}
const cliSpinners: Record<string, SpinnerStyle> = {
  default: defaultStyle,
  ci: ciSpinner,
}

export function getCliSpinners(styleName?: string): SpinnerStyle | undefined
export function getCliSpinners(
  styleName?: string,
): SpinnerStyle | Record<string, SpinnerStyle> | undefined {
  return styleName === undefined
    ? cliSpinners
    : Object.hasOwn(cliSpinners, styleName)
      ? cliSpinners[styleName]
      : undefined
}

export class Spinner {
  color = 'cyan'
  text: string
  spinner: SpinnerStyle
  #stream: NodeJS.WriteStream
  #timer: NodeJS.Timeout | undefined
  #frame = 0
  #indent = 0
  #spinning = false
  #interactive: boolean

  constructor(options: SpinnerOptions = {}) {
    this.text = options.text?.trimStart() ?? ''
    this.spinner =
      options.spinner ?? (process.env['CI'] ? ciSpinner : defaultStyle)
    this.#stream = options.stream ?? process.stderr
    this.color = options.color ?? 'cyan'
    this.#interactive =
      !!this.#stream.isTTY &&
      process.env['TERM'] !== 'dumb' &&
      !('CI' in process.env)
    if (options.signal?.aborted) {
      return
    }
    options.signal?.addEventListener('abort', () => this.stop(), { once: true })
  }

  get isSpinning(): boolean {
    return this.#spinning
  }
  getText(): string {
    return this.text
  }
  setText(text = ''): this {
    this.text = text.trimStart()
    return this
  }
  clear(): this {
    if (this.isSpinning) {
      this.#stream.write('\r\u001b[K')
    }
    return this
  }
  indent(spaces = 2): this {
    this.#indent += spaces
    return this
  }
  dedent(spaces = 2): this {
    this.#indent = Math.max(0, this.#indent - spaces)
    return this
  }
  resetIndent(): this {
    this.#indent = 0
    return this
  }

  start(text?: string): this {
    if (text !== undefined) {
      this.setText(text)
    }
    if (this.isSpinning) {
      return this
    }
    this.#spinning = true
    this.#render()
    if (this.#interactive) {
      this.#timer = setInterval(
        () => this.#render(),
        this.spinner.interval ?? 80,
      )
    }
    return this
  }

  stop(finalText?: string): this {
    if (!this.isSpinning) {
      return this
    }
    if (this.#timer) {
      clearInterval(this.#timer)
    }
    this.#timer = undefined
    this.#spinning = false
    if (this.#interactive) {
      this.#stream.write('\r\u001b[K\u001b[?25h')
    }
    if (finalText) {
      this.#stream.write(
        `${' '.repeat(this.#indent)}${finalText.trimStart()}\n`,
      )
    }
    this.text = ''
    return this
  }

  info(text = ''): this {
    const spinning = this.isSpinning
    this.stop(text)
    if (spinning) {
      this.start()
    }
    return this
  }
  infoAndStop(text = ''): this {
    return this.stop(text)
  }
  success(text = ''): this {
    return this.#symbol('✔', text, true)
  }
  successAndStop(text = ''): this {
    return this.#symbol('✔', text, false)
  }
  fail(text = ''): this {
    return this.#symbol('✖', text, true)
  }
  failAndStop(text = ''): this {
    return this.#symbol('✖', text, false)
  }
  error(text = ''): this {
    return this.fail(text)
  }
  errorAndStop(text = ''): this {
    return this.failAndStop(text)
  }
  warn(text = ''): this {
    return this.#symbol('⚠', text, true)
  }
  warnAndStop(text = ''): this {
    return this.#symbol('⚠', text, false)
  }
  warning(text = ''): this {
    return this.warn(text)
  }
  warningAndStop(text = ''): this {
    return this.warnAndStop(text)
  }
  log(text = ''): this {
    const spinning = this.isSpinning
    this.stop(text)
    if (spinning) {
      this.start()
    }
    return this
  }
  logAndStop(text = ''): this {
    return this.stop(text)
  }
  debug(text = ''): this {
    return this.info(text)
  }
  debugAndStop(text = ''): this {
    return this.infoAndStop(text)
  }

  #symbol(symbol: string, text: string, keepSpinning: boolean): this {
    const spinning = this.isSpinning
    this.stop(`${symbol} ${text}`)
    if (keepSpinning && spinning) {
      this.start()
    }
    return this
  }

  #render(): void {
    const frames = this.spinner.frames
    const frame = frames[this.#frame++ % frames.length] ?? ''
    const value = `${' '.repeat(this.#indent)}${frame ? `${frame} ` : ''}${this.text}`
    if (!value) {
      return
    }
    this.#stream.write(this.#interactive ? `\r\u001b[K${value}` : `${value}\n`)
  }
}

const defaultSpinner = new Spinner()
export default defaultSpinner
