/**
 * @fileoverview CLI spinner utilities for long-running operations.
 * Provides animated progress indicators with CI environment detection.
 */

import type { Writable } from 'stream'

import { getCI } from '#env/ci'
import { isDebug } from './debug'
import { generateSocketSpinnerFrames } from './effects/pulse-frames'
import type {
  ShimmerColorGradient,
  ShimmerConfig,
  ShimmerDirection,
  ShimmerState,
} from './effects/text-shimmer'
import { applyShimmer, COLOR_INHERIT, DIR_LTR } from './effects/text-shimmer'
import yoctoSpinner from '@socketregistry/yocto-spinner'
import {
  LOG_SYMBOLS,
  getDefaultLogger,
  incLogCallCountSymbol,
  lastWasBlankSymbol,
} from './logger'
import { hasOwn } from './objects'
import { isBlankString, stringWidth } from './strings'
import { getTheme } from './themes/context'
import { THEMES } from './themes/themes'
import { resolveColor } from './themes/utils'

/**
 * Named color values supported by the spinner.
 * Maps to standard terminal colors with bright variants.
 */
export type ColorName =
  | 'black'
  | 'blue'
  | 'blueBright'
  | 'cyan'
  | 'cyanBright'
  | 'gray'
  | 'green'
  | 'greenBright'
  | 'magenta'
  | 'magentaBright'
  | 'red'
  | 'redBright'
  | 'white'
  | 'whiteBright'
  | 'yellow'
  | 'yellowBright'

/**
 * Special 'inherit' color value that uses the spinner's current color.
 * Used with shimmer effects to dynamically inherit the spinner color.
 */
export type ColorInherit = 'inherit'

/**
 * RGB color tuple with values 0-255 for red, green, and blue channels.
 * @example [140, 82, 255] // Socket purple
 * @example [255, 0, 0]    // Red
 */
export type ColorRgb = readonly [number, number, number]

/**
 * Union of all supported color types: named colors or RGB tuples.
 */
export type ColorValue = ColorName | ColorRgb

/**
 * Symbol types for status messages.
 * Maps to log symbols: success (✓), fail (✗), info (ℹ), warn (⚠).
 */
export type SymbolType = 'fail' | 'info' | 'success' | 'warn'

// Map color names to RGB values.
const colorToRgb: Record<ColorName, ColorRgb> = {
  __proto__: null,
  black: [0, 0, 0],
  blue: [0, 0, 255],
  blueBright: [100, 149, 237],
  cyan: [0, 255, 255],
  cyanBright: [0, 255, 255],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenBright: [0, 255, 0],
  magenta: [255, 0, 255],
  magentaBright: [255, 105, 180],
  red: [255, 0, 0],
  redBright: [255, 69, 0],
  white: [255, 255, 255],
  whiteBright: [255, 255, 255],
  yellow: [255, 255, 0],
  yellowBright: [255, 255, 153],
} as Record<ColorName, ColorRgb>

/**
 * Type guard to check if a color value is an RGB tuple.
 * @param value - Color value to check
 * @returns `true` if value is an RGB tuple, `false` if it's a color name
 */
function isRgbTuple(value: ColorValue): value is ColorRgb {
  return Array.isArray(value)
}

/**
 * Convert a color value to RGB tuple format.
 * Named colors are looked up in the `colorToRgb` map, RGB tuples are returned as-is.
 * @param color - Color name or RGB tuple
 * @returns RGB tuple with values 0-255
 */
export function toRgb(color: ColorValue): ColorRgb {
  if (isRgbTuple(color)) {
    return color
  }
  return colorToRgb[color]
}

/**
 * Progress tracking information for display in spinner.
 * Used by `progress()` and `progressStep()` methods to show animated progress bars.
 */
export type ProgressInfo = {
  /** Current progress value */
  current: number
  /** Total/maximum progress value */
  total: number
  /** Optional unit label displayed after the progress count (e.g., 'files', 'items') */
  unit?: string | undefined
}

/**
 * Internal shimmer state with color configuration.
 * Extends `ShimmerState` with additional color property that can be inherited from spinner.
 */
export type ShimmerInfo = ShimmerState & {
  /** Color for shimmer effect - can inherit from spinner, use explicit color, or gradient */
  color: ColorInherit | ColorValue | ShimmerColorGradient
}

/**
 * Spinner instance for displaying animated loading indicators.
 * Provides methods for status updates, progress tracking, and text shimmer effects.
 *
 * KEY BEHAVIORS:
 * - Methods WITHOUT "AndStop" keep the spinner running (e.g., `success()`, `fail()`)
 * - Methods WITH "AndStop" auto-clear the spinner line (e.g., `successAndStop()`, `failAndStop()`)
 * - Status messages (done, success, fail, info, warn, step, substep) go to stderr
 * - Data messages (`log()`) go to stdout
 *
 * @example
 * ```ts
 * import { Spinner } from '@socketsecurity/lib/spinner'
 *
 * const spinner = Spinner({ text: 'Loading…' })
 * spinner.start()
 *
 * // Show success while continuing to spin
 * spinner.success('Step 1 complete')
 *
 * // Stop the spinner with success message
 * spinner.successAndStop('All done!')
 * ```
 */
export type Spinner = {
  /** Current spinner color as RGB tuple */
  color: ColorRgb
  /** Current spinner animation style */
  spinner: SpinnerStyle

  /** Whether spinner is currently animating */
  get isSpinning(): boolean

  /** Get current shimmer state (enabled/disabled and configuration) */
  get shimmerState(): ShimmerInfo | undefined

  /** Clear the current line without stopping the spinner */
  clear(): Spinner

  /** Show debug message without stopping (only if debug mode enabled) */
  debug(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Show debug message and stop the spinner (only if debug mode enabled) */
  debugAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Alias for `fail()` - show error without stopping */
  error(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Alias for `failAndStop()` - show error and stop */
  errorAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Show failure (✗) without stopping the spinner */
  fail(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Show failure (✗) and stop the spinner, auto-clearing the line */
  failAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Get current spinner text (getter) or set new text (setter) */
  text(value: string): Spinner
  text(): string

  /** Increase indentation by specified spaces (default: 2) */
  indent(spaces?: number | undefined): Spinner
  /** Decrease indentation by specified spaces (default: 2) */
  dedent(spaces?: number | undefined): Spinner

  /** Show info (ℹ) message without stopping the spinner */
  info(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Show info (ℹ) message and stop the spinner, auto-clearing the line */
  infoAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Log to stdout without stopping the spinner */
  log(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Log and stop the spinner, auto-clearing the line */
  logAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Start spinning with optional text */
  start(text?: string | undefined): Spinner
  /** Stop spinning and clear internal state, auto-clearing the line */
  stop(text?: string | undefined): Spinner
  /** Stop and show final text without clearing the line */
  stopAndPersist(text?: string | undefined): Spinner

  /** Show main step message to stderr without stopping */
  step(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Show indented substep message to stderr without stopping */
  substep(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Show success (✓) without stopping the spinner */
  success(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Show success (✓) and stop the spinner, auto-clearing the line */
  successAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Alias for `success()` - show success without stopping */
  done(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Alias for `successAndStop()` - show success and stop */
  doneAndStop(text?: string | undefined, ...extras: unknown[]): Spinner

  /** Update progress bar with current/total values and optional unit */
  progress(current: number, total: number, unit?: string | undefined): Spinner
  /** Increment progress by specified amount (default: 1) */
  progressStep(amount?: number): Spinner

  /** Enable shimmer effect (restores saved config or uses defaults) */
  enableShimmer(): Spinner
  /** Disable shimmer effect (preserves config for later re-enable) */
  disableShimmer(): Spinner
  /** Set complete shimmer configuration */
  setShimmer(config: ShimmerConfig): Spinner
  /** Update partial shimmer configuration */
  updateShimmer(config: Partial<ShimmerConfig>): Spinner

  /** Show warning (⚠) without stopping the spinner */
  warn(text?: string | undefined, ...extras: unknown[]): Spinner
  /** Show warning (⚠) and stop the spinner, auto-clearing the line */
  warnAndStop(text?: string | undefined, ...extras: unknown[]): Spinner
}

/**
 * Configuration options for creating a spinner instance.
 */
export type SpinnerOptions = {
  /**
   * Spinner color as RGB tuple or color name.
   * @default [140, 82, 255] Socket purple
   */
  readonly color?: ColorValue | undefined
  /**
   * Shimmer effect configuration or direction string.
   * When enabled, text will have an animated shimmer effect.
   * @default undefined No shimmer effect
   */
  readonly shimmer?: ShimmerConfig | ShimmerDirection | undefined
  /**
   * Animation style with frames and timing.
   * @default 'socket' Custom Socket animation in CLI, minimal in CI
   */
  readonly spinner?: SpinnerStyle | undefined
  /**
   * Abort signal for cancelling the spinner.
   * @default getAbortSignal() from process constants
   */
  readonly signal?: AbortSignal | undefined
  /**
   * Output stream for spinner rendering.
   * @default process.stderr
   */
  readonly stream?: Writable | undefined
  /**
   * Initial text to display with the spinner.
   * @default undefined No initial text
   */
  readonly text?: string | undefined
  /**
   * Theme to use for spinner colors.
   * Accepts theme name ('socket', 'sunset', etc.) or Theme object.
   * @default Current theme from getTheme()
   */
  readonly theme?:
    | import('./themes/types').Theme
    | import('./themes/themes').ThemeName
    | undefined
}

/**
 * Animation style definition for spinner frames.
 * Defines the visual appearance and timing of the spinner animation.
 */
export type SpinnerStyle = {
  /** Array of animation frames (strings to display sequentially) */
  readonly frames: string[]
  /**
   * Milliseconds between frame changes.
   * @default 80 Standard frame rate
   */
  readonly interval?: number | undefined
}

/**
 * Minimal spinner style for CI environments.
 * Uses empty frame and max interval to effectively disable animation in CI.
 */
export const ciSpinner: SpinnerStyle = {
  frames: [''],
  interval: 2_147_483_647,
}

/**
 * Create a property descriptor for defining non-enumerable properties.
 * Used for adding aliased methods to the Spinner prototype.
 * @param value - Value for the property
 * @returns Property descriptor object
 * @private
 */
function desc(value: unknown) {
  return {
    __proto__: null,
    configurable: true,
    value,
    writable: true,
  }
}

/**
 * Normalize text input by trimming leading whitespace.
 * Non-string values are converted to empty string.
 * @param value - Text to normalize
 * @returns Normalized string with leading whitespace removed
 * @private
 */
function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trimStart() : ''
}

/**
 * Format progress information as a visual progress bar with percentage and count.
 * @param progress - Progress tracking information
 * @returns Formatted string with colored progress bar, percentage, and count
 * @private
 * @example "███████░░░░░░░░░░░░░ 35% (7/20 files)"
 */
function formatProgress(progress: ProgressInfo): string {
  const { current, total, unit } = progress
  const percentage = Math.round((current / total) * 100)
  const bar = renderProgressBar(percentage)
  const count = unit ? `${current}/${total} ${unit}` : `${current}/${total}`
  return `${bar} ${percentage}% (${count})`
}

/**
 * Render a progress bar using block characters (█ for filled, ░ for empty).
 * @param percentage - Progress percentage (0-100)
 * @param width - Total width of progress bar in characters
 * @returns Colored progress bar string
 * @default width=20
 * @private
 */
function renderProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  // Use cyan color for the progress bar
  const colors =
    /*@__PURE__*/ require('yoctocolors-cjs') as typeof import('yoctocolors-cjs')
  return colors.cyan(bar)
}

let _cliSpinners: Record<string, SpinnerStyle> | undefined

/**
 * Get available CLI spinner styles or a specific style by name.
 * Extends the standard cli-spinners collection with Socket custom spinners.
 *
 * Custom spinners:
 * - `socket` (default): Socket pulse animation with sparkles and lightning
 *
 * @param styleName - Optional name of specific spinner style to retrieve
 * @returns Specific spinner style if name provided, all styles if omitted, `undefined` if style not found
 * @see https://github.com/sindresorhus/cli-spinners/blob/main/spinners.json
 *
 * @example
 * ```ts
 * // Get all available spinner styles
 * const allSpinners = getCliSpinners()
 *
 * // Get specific style
 * const socketStyle = getCliSpinners('socket')
 * const dotsStyle = getCliSpinners('dots')
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function getCliSpinners(
  styleName?: string | undefined,
): SpinnerStyle | Record<string, SpinnerStyle> | undefined {
  if (_cliSpinners === undefined) {
    const YoctoCtor: any = yoctoSpinner as any
    // Get the YoctoSpinner class to access static properties.
    const tempInstance: any = YoctoCtor({})
    const YoctoSpinnerClass: any = tempInstance.constructor as any
    // Extend the standard cli-spinners collection with Socket custom spinners.
    _cliSpinners = {
      __proto__: null,
      ...YoctoSpinnerClass.spinners,
      socket: generateSocketSpinnerFrames(),
    }
  }
  if (typeof styleName === 'string' && _cliSpinners) {
    return hasOwn(_cliSpinners, styleName) ? _cliSpinners[styleName] : undefined
  }
  return _cliSpinners
}

let _Spinner: {
  new (options?: SpinnerOptions | undefined): Spinner
}
let _defaultSpinner: SpinnerStyle | undefined

/**
 * Create a spinner instance for displaying loading indicators.
 * Provides an animated CLI spinner with status messages, progress tracking, and shimmer effects.
 *
 * AUTO-CLEAR BEHAVIOR:
 * - All *AndStop() methods AUTO-CLEAR the spinner line via yocto-spinner.stop()
 *   Examples: `doneAndStop()`, `successAndStop()`, `failAndStop()`, etc.
 *
 * - Methods WITHOUT "AndStop" do NOT clear (spinner keeps spinning)
 *   Examples: `done()`, `success()`, `fail()`, etc.
 *
 * STREAM USAGE:
 * - Spinner animation: stderr (yocto-spinner default)
 * - Status methods (done, success, fail, info, warn, step, substep): stderr
 * - Data methods (`log()`): stdout
 *
 * COMPARISON WITH LOGGER:
 * - `logger.done()` does NOT auto-clear (requires manual `logger.clearLine()`)
 * - `spinner.doneAndStop()` DOES auto-clear (built into yocto-spinner.stop())
 * - Pattern: `logger.clearLine().done()` vs `spinner.doneAndStop()`
 *
 * @param options - Configuration options for the spinner
 * @returns New spinner instance
 *
 * @example
 * ```ts
 * import { Spinner } from '@socketsecurity/lib/spinner'
 *
 * // Basic usage
 * const spinner = Spinner({ text: 'Loading data…' })
 * spinner.start()
 * await fetchData()
 * spinner.successAndStop('Data loaded!')
 *
 * // With custom color
 * const spinner = Spinner({
 *   text: 'Processing…',
 *   color: [255, 0, 0] // Red
 * })
 *
 * // With shimmer effect
 * const spinner = Spinner({
 *   text: 'Building…',
 *   shimmer: { dir: 'ltr', speed: 0.5 }
 * })
 *
 * // Show progress
 * spinner.progress(5, 10, 'files')
 * spinner.progressStep() // Increment by 1
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function Spinner(options?: SpinnerOptions | undefined): Spinner {
  if (_Spinner === undefined) {
    const YoctoCtor = yoctoSpinner as any
    // Get the actual YoctoSpinner class from an instance
    const tempInstance = YoctoCtor({})
    const YoctoSpinnerClass = tempInstance.constructor
    const logger = getDefaultLogger()

    /*@__PURE__*/
    _Spinner = class SpinnerClass extends (YoctoSpinnerClass as any) {
      declare isSpinning: boolean
      #baseText: string = ''
      #indentation: string = ''
      #progress?: ProgressInfo | undefined
      #shimmer?: ShimmerInfo | undefined
      #shimmerSavedConfig?: ShimmerInfo | undefined

      constructor(options?: SpinnerOptions | undefined) {
        const opts = { __proto__: null, ...options } as SpinnerOptions

        // Get theme from options or current theme
        let theme = getTheme()
        if (opts.theme) {
          // Resolve theme name or use Theme object directly
          if (typeof opts.theme === 'string') {
            theme = THEMES[opts.theme]
          } else {
            theme = opts.theme
          }
        }

        // Get default color from theme if not specified
        let defaultColor: ColorValue = theme.colors.primary
        if (theme.effects?.spinner?.color) {
          const resolved = resolveColor(
            theme.effects.spinner.color,
            theme.colors,
          )
          // resolveColor can return 'inherit' or gradients which aren't valid for spinner
          // Fall back to primary for these cases
          if (resolved === 'inherit' || Array.isArray(resolved[0])) {
            defaultColor = theme.colors.primary
          } else {
            defaultColor = resolved as ColorValue
          }
        }

        // Convert color option to RGB (default from theme).
        const spinnerColor = opts.color ?? defaultColor

        // Validate RGB tuple if provided.
        if (
          isRgbTuple(spinnerColor) &&
          (spinnerColor.length !== 3 ||
            !spinnerColor.every(
              n => typeof n === 'number' && n >= 0 && n <= 255,
            ))
        ) {
          throw new TypeError(
            'RGB color must be an array of 3 numbers between 0 and 255',
          )
        }

        const spinnerColorRgb = toRgb(spinnerColor)

        // Parse shimmer config - can be object or direction string.
        let shimmerInfo: ShimmerInfo | undefined
        if (opts.shimmer) {
          let shimmerDir: ShimmerDirection
          let shimmerColor:
            | ColorInherit
            | ColorValue
            | ShimmerColorGradient
            | undefined
          // Default: 0.33 steps per frame (~150ms per step).
          let shimmerSpeed: number = 1 / 3

          if (typeof opts.shimmer === 'string') {
            shimmerDir = opts.shimmer
          } else {
            const shimmerConfig = {
              __proto__: null,
              ...opts.shimmer,
            } as ShimmerConfig
            shimmerDir = shimmerConfig.dir ?? DIR_LTR
            shimmerColor = shimmerConfig.color ?? COLOR_INHERIT
            shimmerSpeed = shimmerConfig.speed ?? 1 / 3
          }

          // Create shimmer info with initial animation state:
          // - COLOR_INHERIT means use spinner color dynamically
          // - ColorValue (name or RGB tuple) is an explicit override color
          // - undefined color defaults to COLOR_INHERIT
          // - speed controls steps per frame (lower = slower, e.g., 0.33 = ~150ms per step)
          shimmerInfo = {
            __proto__: null,
            color: shimmerColor === undefined ? COLOR_INHERIT : shimmerColor,
            currentDir: DIR_LTR,
            mode: shimmerDir,
            speed: shimmerSpeed,
            step: 0,
          } as ShimmerInfo
        }

        // eslint-disable-next-line constructor-super
        super({
          signal: require('#constants/process').getAbortSignal(),
          ...opts,
          // Pass RGB color directly to yocto-spinner (it now supports RGB).
          color: spinnerColorRgb,
          // onRenderFrame callback provides full control over frame + text layout.
          // Calculates spacing based on frame width to prevent text jumping.
          onRenderFrame: (
            frame: string,
            text: string,
            applyColor: (text: string) => string,
          ) => {
            const width = stringWidth(frame)
            // Narrow frames (width 1) get 2 spaces, wide frames (width 2) get 1 space.
            // Total width is consistent: 3 characters (frame + spacing) before text.
            const spacing = width === 1 ? '  ' : ' '
            return frame ? `${applyColor(frame)}${spacing}${text}` : text
          },
          // onFrameUpdate callback is called by yocto-spinner whenever a frame advances.
          // This ensures shimmer updates are perfectly synchronized with animation beats.
          onFrameUpdate: shimmerInfo
            ? () => {
                // Update parent's text without triggering render.
                // Parent's #skipRender flag prevents nested render calls.
                // Only update if we have base text to avoid blank frames.
                if (this.#baseText) {
                  super.text = this.#buildDisplayText()
                }
              }
            : undefined,
        })

        this.#shimmer = shimmerInfo
        this.#shimmerSavedConfig = shimmerInfo
      }

      // Override color getter to ensure it's always RGB.
      get color(): ColorRgb {
        const value = super.color
        return isRgbTuple(value) ? value : toRgb(value)
      }

      // Override color setter to always convert to RGB before passing to yocto-spinner.
      set color(value: ColorValue | ColorRgb) {
        super.color = isRgbTuple(value) ? value : toRgb(value)
      }

      // Getter to expose current shimmer state.
      get shimmerState(): ShimmerInfo | undefined {
        if (!this.#shimmer) {
          return undefined
        }
        return {
          color: this.#shimmer.color,
          currentDir: this.#shimmer.currentDir,
          mode: this.#shimmer.mode,
          speed: this.#shimmer.speed,
          step: this.#shimmer.step,
        } as ShimmerInfo
      }

      /**
       * Apply a yocto-spinner method and update logger state.
       * Handles text normalization, extra arguments, and logger tracking.
       * @private
       */
      #apply(methodName: string, args: unknown[]) {
        let extras: unknown[]
        let text = args.at(0)
        if (typeof text === 'string') {
          extras = args.slice(1)
        } else {
          extras = args
          text = ''
        }
        const wasSpinning = this.isSpinning
        const normalized = normalizeText(text)
        if (methodName === 'stop' && !normalized) {
          super[methodName]()
        } else {
          super[methodName](normalized)
        }
        if (methodName === 'stop') {
          if (wasSpinning && normalized) {
            logger[lastWasBlankSymbol](isBlankString(normalized))
            logger[incLogCallCountSymbol]()
          }
        } else {
          logger[lastWasBlankSymbol](false)
          logger[incLogCallCountSymbol]()
        }
        if (extras.length) {
          logger.log(...extras)
          logger[lastWasBlankSymbol](false)
        }
        return this
      }

      /**
       * Build the complete display text with progress, shimmer, and indentation.
       * Combines base text, progress bar, shimmer effects, and indentation.
       * @private
       */
      #buildDisplayText() {
        let displayText = this.#baseText

        if (this.#progress) {
          const progressText = formatProgress(this.#progress)
          displayText = displayText
            ? `${displayText} ${progressText}`
            : progressText
        }

        // Apply shimmer effect if enabled.
        if (displayText && this.#shimmer) {
          // If shimmer color is 'inherit', use current spinner color (getter ensures RGB).
          // Otherwise, check if it's a gradient (array of arrays) or single color.
          let shimmerColor: ColorRgb | ShimmerColorGradient
          if (this.#shimmer.color === COLOR_INHERIT) {
            shimmerColor = this.color
          } else if (Array.isArray(this.#shimmer.color[0])) {
            // It's a gradient - use as is.
            shimmerColor = this.#shimmer.color as ShimmerColorGradient
          } else {
            // It's a single color - convert to RGB.
            shimmerColor = toRgb(this.#shimmer.color as ColorValue)
          }

          displayText = applyShimmer(displayText, this.#shimmer, {
            color: shimmerColor,
            direction: this.#shimmer.mode,
          })
        }

        // Apply indentation
        if (this.#indentation && displayText) {
          displayText = this.#indentation + displayText
        }

        return displayText
      }

      /**
       * Show a status message without stopping the spinner.
       * Outputs the symbol and message to stderr, then continues spinning.
       */
      #showStatusAndKeepSpinning(symbolType: SymbolType, args: unknown[]) {
        let text = args.at(0)
        let extras: unknown[]
        if (typeof text === 'string') {
          extras = args.slice(1)
        } else {
          extras = args
          text = ''
        }

        // Note: Status messages always go to stderr.
        logger.error(`${LOG_SYMBOLS[symbolType]} ${text}`, ...extras)
        return this
      }

      /**
       * Update the spinner's displayed text.
       * Rebuilds display text and triggers render.
       * @private
       */
      #updateSpinnerText() {
        // Call the parent class's text setter, which triggers render.
        super.text = this.#buildDisplayText()
      }

      /**
       * Show a debug message (ℹ) without stopping the spinner.
       * Only displays if debug mode is enabled via environment variable.
       * Outputs to stderr and continues spinning.
       *
       * @param text - Debug message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      debug(text?: string | undefined, ...extras: unknown[]) {
        if (isDebug()) {
          return this.#showStatusAndKeepSpinning('info', [text, ...extras])
        }
        return this
      }

      /**
       * Show a debug message (ℹ) and stop the spinner.
       * Only displays if debug mode is enabled via environment variable.
       * Auto-clears the spinner line before displaying the message.
       *
       * @param text - Debug message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      debugAndStop(text?: string | undefined, ...extras: unknown[]) {
        if (isDebug()) {
          return this.#apply('info', [text, ...extras])
        }
        return this
      }

      /**
       * Decrease indentation level by removing spaces from the left.
       * Pass 0 to reset indentation to zero completely.
       *
       * @param spaces - Number of spaces to remove
       * @returns This spinner for chaining
       * @default spaces=2
       *
       * @example
       * ```ts
       * spinner.dedent()    // Remove 2 spaces
       * spinner.dedent(4)   // Remove 4 spaces
       * spinner.dedent(0)   // Reset to zero indentation
       * ```
       */
      dedent(spaces?: number | undefined) {
        // Pass 0 to reset indentation
        if (spaces === 0) {
          this.#indentation = ''
        } else {
          const amount = spaces ?? 2
          const newLength = Math.max(0, this.#indentation.length - amount)
          this.#indentation = this.#indentation.slice(0, newLength)
        }
        this.#updateSpinnerText()
        return this
      }

      /**
       * Show a done/success message (✓) without stopping the spinner.
       * Alias for `success()` with a shorter name.
       *
       * DESIGN DECISION: Unlike yocto-spinner, our `done()` does NOT stop the spinner.
       * Use `doneAndStop()` if you want to stop the spinner.
       *
       * @param text - Message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      done(text?: string | undefined, ...extras: unknown[]) {
        return this.#showStatusAndKeepSpinning('success', [text, ...extras])
      }

      /**
       * Show a done/success message (✓) and stop the spinner.
       * Auto-clears the spinner line before displaying the success message.
       *
       * @param text - Message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      doneAndStop(text?: string | undefined, ...extras: unknown[]) {
        return this.#apply('success', [text, ...extras])
      }

      /**
       * Show a failure message (✗) without stopping the spinner.
       * DESIGN DECISION: Unlike yocto-spinner, our `fail()` does NOT stop the spinner.
       * This allows displaying errors while continuing to spin.
       * Use `failAndStop()` if you want to stop the spinner.
       *
       * @param text - Error message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      fail(text?: string | undefined, ...extras: unknown[]) {
        return this.#showStatusAndKeepSpinning('fail', [text, ...extras])
      }

      /**
       * Show a failure message (✗) and stop the spinner.
       * Auto-clears the spinner line before displaying the error message.
       *
       * @param text - Error message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      failAndStop(text?: string | undefined, ...extras: unknown[]) {
        return this.#apply('error', [text, ...extras])
      }

      /**
       * Increase indentation level by adding spaces to the left.
       * Pass 0 to reset indentation to zero completely.
       *
       * @param spaces - Number of spaces to add
       * @returns This spinner for chaining
       * @default spaces=2
       *
       * @example
       * ```ts
       * spinner.indent()    // Add 2 spaces
       * spinner.indent(4)   // Add 4 spaces
       * spinner.indent(0)   // Reset to zero indentation
       * ```
       */
      indent(spaces?: number | undefined) {
        // Pass 0 to reset indentation
        if (spaces === 0) {
          this.#indentation = ''
        } else {
          const amount = spaces ?? 2
          this.#indentation += ' '.repeat(amount)
        }
        this.#updateSpinnerText()
        return this
      }

      /**
       * Show an info message (ℹ) without stopping the spinner.
       * Outputs to stderr and continues spinning.
       *
       * @param text - Info message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      info(text?: string | undefined, ...extras: unknown[]) {
        return this.#showStatusAndKeepSpinning('info', [text, ...extras])
      }

      /**
       * Show an info message (ℹ) and stop the spinner.
       * Auto-clears the spinner line before displaying the message.
       *
       * @param text - Info message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      infoAndStop(text?: string | undefined, ...extras: unknown[]) {
        return this.#apply('info', [text, ...extras])
      }

      /**
       * Log a message to stdout without stopping the spinner.
       * Unlike other status methods, this outputs to stdout for data logging.
       *
       * @param args - Values to log to stdout
       * @returns This spinner for chaining
       */
      log(...args: unknown[]) {
        logger.log(...args)
        return this
      }

      /**
       * Log a message to stdout and stop the spinner.
       * Auto-clears the spinner line before displaying the message.
       *
       * @param text - Message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      logAndStop(text?: string | undefined, ...extras: unknown[]) {
        return this.#apply('stop', [text, ...extras])
      }

      /**
       * Update progress information displayed with the spinner.
       * Shows a progress bar with percentage and optional unit label.
       *
       * @param current - Current progress value
       * @param total - Total/maximum progress value
       * @param unit - Optional unit label (e.g., 'files', 'items')
       * @returns This spinner for chaining
       *
       * @example
       * ```ts
       * spinner.progress(5, 10)            // "███████░░░░░░░░░░░░░ 50% (5/10)"
       * spinner.progress(7, 20, 'files')   // "███████░░░░░░░░░░░░░ 35% (7/20 files)"
       * ```
       */
      progress = (
        current: number,
        total: number,
        unit?: string | undefined,
      ) => {
        this.#progress = {
          __proto__: null,
          current,
          total,
          ...(unit ? { unit } : {}),
        } as ProgressInfo
        this.#updateSpinnerText()
        return this
      }

      /**
       * Increment progress by a specified amount.
       * Updates the progress bar displayed with the spinner.
       * Clamps the result between 0 and the total value.
       *
       * @param amount - Amount to increment by
       * @returns This spinner for chaining
       * @default amount=1
       *
       * @example
       * ```ts
       * spinner.progress(0, 10, 'files')
       * spinner.progressStep()    // Progress: 1/10
       * spinner.progressStep(3)   // Progress: 4/10
       * ```
       */
      progressStep(amount: number = 1) {
        if (this.#progress) {
          const newCurrent = this.#progress.current + amount
          this.#progress = {
            __proto__: null,
            current: Math.max(0, Math.min(newCurrent, this.#progress.total)),
            total: this.#progress.total,
            ...(this.#progress.unit ? { unit: this.#progress.unit } : {}),
          } as ProgressInfo
          this.#updateSpinnerText()
        }
        return this
      }

      /**
       * Start the spinner animation with optional text.
       * Begins displaying the animated spinner on stderr.
       *
       * @param text - Optional text to display with the spinner
       * @returns This spinner for chaining
       *
       * @example
       * ```ts
       * spinner.start('Loading…')
       * // Later:
       * spinner.successAndStop('Done!')
       * ```
       */
      start(...args: unknown[]) {
        if (args.length) {
          const text = args.at(0)
          const normalized = normalizeText(text)
          // We clear this.text on start when `text` is falsy because yocto-spinner
          // will not clear it otherwise.
          if (!normalized) {
            this.#baseText = ''
            super.text = ''
          } else {
            this.#baseText = normalized
          }
        }

        this.#updateSpinnerText()
        // Don't pass text to yocto-spinner.start() since we already set it via #updateSpinnerText().
        // Passing args would cause duplicate message output.
        return this.#apply('start', [])
      }

      /**
       * Log a main step message to stderr without stopping the spinner.
       * Adds a blank line before the message for visual separation.
       * Aligns with `logger.step()` to use stderr for status messages.
       *
       * @param text - Step message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       *
       * @example
       * ```ts
       * spinner.step('Building application')
       * spinner.substep('Compiling TypeScript')
       * spinner.substep('Bundling assets')
       * ```
       */
      step(text?: string | undefined, ...extras: unknown[]) {
        if (typeof text === 'string') {
          // Add blank line before step for visual separation.
          logger.error('')
          // Use error (stderr) to align with logger.step() default stream.
          logger.error(text, ...extras)
        }
        return this
      }

      /**
       * Log an indented substep message to stderr without stopping the spinner.
       * Adds 2-space indentation to the message.
       * Aligns with `logger.substep()` to use stderr for status messages.
       *
       * @param text - Substep message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       *
       * @example
       * ```ts
       * spinner.step('Building application')
       * spinner.substep('Compiling TypeScript')
       * spinner.substep('Bundling assets')
       * ```
       */
      substep(text?: string | undefined, ...extras: unknown[]) {
        if (typeof text === 'string') {
          // Add 2-space indent for substep.
          // Use error (stderr) to align with logger.substep() default stream.
          logger.error(`  ${text}`, ...extras)
        }
        return this
      }

      /**
       * Stop the spinner animation and clear internal state.
       * Auto-clears the spinner line via yocto-spinner.stop().
       * Resets progress, shimmer, and text state.
       *
       * @param text - Optional final text to display after stopping
       * @returns This spinner for chaining
       *
       * @example
       * ```ts
       * spinner.start('Processing…')
       * // Do work
       * spinner.stop() // Just stop, no message
       * // or
       * spinner.stop('Finished processing')
       * ```
       */
      stop(...args: unknown[]) {
        // Clear the spinner text BEFORE stopping to prevent ghost frames.
        // This ensures the terminal line is fully cleared before we stop the animation.
        if (!args.length || !args[0]) {
          super.text = ''
        }

        // Clear internal state.
        this.#baseText = ''
        this.#progress = undefined
        // Reset shimmer animation state if shimmer is enabled.
        if (this.#shimmer) {
          this.#shimmer.currentDir = DIR_LTR
          this.#shimmer.step = 0
        }
        // Call parent stop (clears screen, sets isSpinning = false).
        const result = this.#apply('stop', args)
        // Ensure text is cleared after stop completes.
        super.text = ''
        return result
      }

      /**
       * Show a success message (✓) without stopping the spinner.
       * DESIGN DECISION: Unlike yocto-spinner, our `success()` does NOT stop the spinner.
       * This allows displaying success messages while continuing to spin for multi-step operations.
       * Use `successAndStop()` if you want to stop the spinner.
       *
       * @param text - Success message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      success(text?: string | undefined, ...extras: unknown[]) {
        return this.#showStatusAndKeepSpinning('success', [text, ...extras])
      }

      /**
       * Show a success message (✓) and stop the spinner.
       * Auto-clears the spinner line before displaying the success message.
       *
       * @param text - Success message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      successAndStop(text?: string | undefined, ...extras: unknown[]) {
        return this.#apply('success', [text, ...extras])
      }

      /**
       * Get or set the spinner text.
       * When called with no arguments, returns the current base text.
       * When called with text, updates the display and returns the spinner for chaining.
       *
       * @param value - Text to display (omit to get current text)
       * @returns Current text (getter) or this spinner (setter)
       *
       * @example
       * ```ts
       * // Setter
       * spinner.text('Loading data…')
       * spinner.text('Processing…')
       *
       * // Getter
       * const current = spinner.text()
       * console.log(current) // "Processing…"
       * ```
       */
      text(): string
      text(value: string): Spinner
      text(value?: string): string | Spinner {
        // biome-ignore lint/complexity/noArguments: Function overload for getter/setter pattern.
        if (arguments.length === 0) {
          // Getter: return current base text
          return this.#baseText
        }
        // Setter: update base text and refresh display
        this.#baseText = value ?? ''
        this.#updateSpinnerText()
        return this as unknown as Spinner
      }

      /**
       * Show a warning message (⚠) without stopping the spinner.
       * Outputs to stderr and continues spinning.
       *
       * @param text - Warning message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      warn(text?: string | undefined, ...extras: unknown[]) {
        return this.#showStatusAndKeepSpinning('warn', [text, ...extras])
      }

      /**
       * Show a warning message (⚠) and stop the spinner.
       * Auto-clears the spinner line before displaying the warning message.
       *
       * @param text - Warning message to display
       * @param extras - Additional values to log
       * @returns This spinner for chaining
       */
      warnAndStop(text?: string | undefined, ...extras: unknown[]) {
        return this.#apply('warning', [text, ...extras])
      }

      /**
       * Enable shimmer effect.
       * Restores saved config or uses defaults if no saved config exists.
       *
       * @returns This spinner for chaining
       *
       * @example
       * spinner.enableShimmer()
       */
      enableShimmer(): Spinner {
        if (this.#shimmerSavedConfig) {
          // Restore saved config.
          this.#shimmer = { ...this.#shimmerSavedConfig }
        } else {
          // Create default config.
          this.#shimmer = {
            color: COLOR_INHERIT,
            currentDir: DIR_LTR,
            mode: DIR_LTR,
            speed: 1 / 3,
            step: 0,
          } as ShimmerInfo
          this.#shimmerSavedConfig = this.#shimmer
        }

        this.#updateSpinnerText()
        return this as unknown as Spinner
      }

      /**
       * Disable shimmer effect.
       * Preserves config for later re-enable via enableShimmer().
       *
       * @returns This spinner for chaining
       *
       * @example
       * spinner.disableShimmer()
       */
      disableShimmer(): Spinner {
        // Disable shimmer but preserve config.
        this.#shimmer = undefined
        this.#updateSpinnerText()
        return this as unknown as Spinner
      }

      /**
       * Set complete shimmer configuration.
       * Replaces any existing shimmer config with the provided values.
       * Undefined properties will use default values.
       *
       * @param config - Complete shimmer configuration
       * @returns This spinner for chaining
       *
       * @example
       * spinner.setShimmer({
       *   color: [255, 0, 0],
       *   dir: 'rtl',
       *   speed: 0.5
       * })
       */
      setShimmer(config: ShimmerConfig): Spinner {
        this.#shimmer = {
          color: config.color ?? COLOR_INHERIT,
          currentDir: DIR_LTR,
          mode: config.dir ?? DIR_LTR,
          speed: config.speed ?? 1 / 3,
          step: 0,
        } as ShimmerInfo
        this.#shimmerSavedConfig = this.#shimmer
        this.#updateSpinnerText()
        return this as unknown as Spinner
      }

      /**
       * Update partial shimmer configuration.
       * Merges with existing config, enabling shimmer if currently disabled.
       *
       * @param config - Partial shimmer configuration to merge
       * @returns This spinner for chaining
       *
       * @example
       * // Update just the speed
       * spinner.updateShimmer({ speed: 0.5 })
       *
       * // Update direction
       * spinner.updateShimmer({ dir: 'rtl' })
       *
       * // Update multiple properties
       * spinner.updateShimmer({ color: [255, 0, 0], speed: 0.8 })
       */
      updateShimmer(config: Partial<ShimmerConfig>): Spinner {
        const partialConfig = {
          __proto__: null,
          ...config,
        } as Partial<ShimmerConfig>

        if (this.#shimmer) {
          // Update existing shimmer.
          this.#shimmer = {
            ...this.#shimmer,
            ...(partialConfig.color !== undefined
              ? { color: partialConfig.color }
              : {}),
            ...(partialConfig.dir !== undefined
              ? { mode: partialConfig.dir }
              : {}),
            ...(partialConfig.speed !== undefined
              ? { speed: partialConfig.speed }
              : {}),
          } as ShimmerInfo
          this.#shimmerSavedConfig = this.#shimmer
        } else if (this.#shimmerSavedConfig) {
          // Restore and update.
          this.#shimmer = {
            ...this.#shimmerSavedConfig,
            ...(partialConfig.color !== undefined
              ? { color: partialConfig.color }
              : {}),
            ...(partialConfig.dir !== undefined
              ? { mode: partialConfig.dir }
              : {}),
            ...(partialConfig.speed !== undefined
              ? { speed: partialConfig.speed }
              : {}),
          } as ShimmerInfo
          this.#shimmerSavedConfig = this.#shimmer
        } else {
          // Create new with partial config.
          this.#shimmer = {
            color: partialConfig.color ?? COLOR_INHERIT,
            currentDir: DIR_LTR,
            mode: partialConfig.dir ?? DIR_LTR,
            speed: partialConfig.speed ?? 1 / 3,
            step: 0,
          } as ShimmerInfo
          this.#shimmerSavedConfig = this.#shimmer
        }

        this.#updateSpinnerText()
        return this as unknown as Spinner
      }
    } as unknown as {
      new (options?: SpinnerOptions | undefined): Spinner
    }
    // Add aliases.
    Object.defineProperties(_Spinner.prototype, {
      error: desc(_Spinner.prototype.fail),
      errorAndStop: desc(_Spinner.prototype.failAndStop),
      warning: desc(_Spinner.prototype.warn),
      warningAndStop: desc(_Spinner.prototype.warnAndStop),
    })
    _defaultSpinner = getCI()
      ? ciSpinner
      : (getCliSpinners('socket') as SpinnerStyle)
  }
  return new _Spinner({
    spinner: _defaultSpinner,
    ...options,
  })
}

let _spinner: ReturnType<typeof Spinner> | undefined

/**
 * Get the default spinner instance.
 * Lazily creates the spinner to avoid circular dependencies during module initialization.
 * Reuses the same instance across calls.
 *
 * @returns Shared default spinner instance
 *
 * @example
 * ```ts
 * import { getDefaultSpinner } from '@socketsecurity/lib/spinner'
 *
 * const spinner = getDefaultSpinner()
 * spinner.start('Loading…')
 * ```
 */
export function getDefaultSpinner(): ReturnType<typeof Spinner> {
  if (_spinner === undefined) {
    _spinner = Spinner()
  }
  return _spinner
}

// REMOVED: Deprecated `spinner` export
// Migration: Use getDefaultSpinner() instead
// See: getDefaultSpinner() function above

/**
 * Configuration options for `withSpinner()` helper.
 * @template T - Return type of the async operation
 */
export type WithSpinnerOptions<T> = {
  /** Message to display while the spinner is running */
  message: string
  /** Async function to execute while spinner is active */
  operation: () => Promise<T>
  /**
   * Optional spinner instance to use.
   * If not provided, operation runs without spinner.
   */
  spinner?: Spinner | undefined
  /**
   * Optional spinner options to apply during the operation.
   * These options will be pushed when the operation starts and popped when it completes.
   * Supports color and shimmer configuration.
   */
  withOptions?: Partial<Pick<SpinnerOptions, 'color' | 'shimmer'>> | undefined
}

/**
 * Execute an async operation with spinner lifecycle management.
 * Ensures `spinner.stop()` is always called via try/finally, even if the operation throws.
 * Provides safe cleanup and consistent spinner behavior.
 *
 * @template T - Return type of the operation
 * @param options - Configuration object
 * @param options.message - Message to display while spinner is running
 * @param options.operation - Async function to execute
 * @param options.spinner - Optional spinner instance (if not provided, no spinner is used)
 * @returns Result of the operation
 * @throws Re-throws any error from operation after stopping spinner
 *
 * @example
 * ```ts
 * import { Spinner, withSpinner } from '@socketsecurity/lib/spinner'
 *
 * const spinner = Spinner()
 *
 * // With spinner instance
 * const result = await withSpinner({
 *   message: 'Processing…',
 *   operation: async () => {
 *     return await processData()
 *   },
 *   spinner
 * })
 *
 * // Without spinner instance (no-op, just runs operation)
 * const result = await withSpinner({
 *   message: 'Processing…',
 *   operation: async () => {
 *     return await processData()
 *   }
 * })
 * ```
 */
export async function withSpinner<T>(
  options: WithSpinnerOptions<T>,
): Promise<T> {
  const { message, operation, spinner, withOptions } = {
    __proto__: null,
    ...options,
  } as WithSpinnerOptions<T>

  if (!spinner) {
    return await operation()
  }

  // Save current options if we're going to change them
  const savedColor =
    withOptions?.color !== undefined ? spinner.color : undefined
  const savedShimmerState =
    withOptions?.shimmer !== undefined ? spinner.shimmerState : undefined

  // Apply temporary options
  if (withOptions?.color !== undefined) {
    spinner.color = toRgb(withOptions.color)
  }
  if (withOptions?.shimmer !== undefined) {
    if (typeof withOptions.shimmer === 'string') {
      spinner.updateShimmer({ dir: withOptions.shimmer })
    } else {
      spinner.setShimmer(withOptions.shimmer)
    }
  }

  spinner.start(message)
  try {
    return await operation()
  } finally {
    spinner.stop()
    // Restore previous options
    if (savedColor !== undefined) {
      spinner.color = savedColor
    }
    if (withOptions?.shimmer !== undefined) {
      if (savedShimmerState) {
        spinner.setShimmer({
          color: savedShimmerState.color as any,
          dir: savedShimmerState.mode,
          speed: savedShimmerState.speed,
        })
      } else {
        spinner.disableShimmer()
      }
    }
  }
}

/**
 * Configuration options for `withSpinnerRestore()` helper.
 * @template T - Return type of the async operation
 */
export type WithSpinnerRestoreOptions<T> = {
  /** Async function to execute while spinner is stopped */
  operation: () => Promise<T>
  /** Optional spinner instance to restore after operation */
  spinner?: Spinner | undefined
  /** Whether spinner was spinning before the operation (used to conditionally restart) */
  wasSpinning: boolean
}

/**
 * Execute an async operation with conditional spinner restart.
 * Useful when you need to temporarily stop a spinner for an operation,
 * then restore it to its previous state (if it was spinning).
 *
 * @template T - Return type of the operation
 * @param options - Configuration object
 * @param options.operation - Async function to execute
 * @param options.spinner - Optional spinner instance to manage
 * @param options.wasSpinning - Whether spinner was spinning before the operation
 * @returns Result of the operation
 * @throws Re-throws any error from operation after restoring spinner state
 *
 * @example
 * ```ts
 * import { getDefaultSpinner, withSpinnerRestore } from '@socketsecurity/lib/spinner'
 *
 * const spinner = getDefaultSpinner()
 * const wasSpinning = spinner.isSpinning
 * spinner.stop()
 *
 * const result = await withSpinnerRestore({
 *   operation: async () => {
 *     // Do work without spinner
 *     return await someOperation()
 *   },
 *   spinner,
 *   wasSpinning
 * })
 * // Spinner is automatically restarted if wasSpinning was true
 * ```
 */
export async function withSpinnerRestore<T>(
  options: WithSpinnerRestoreOptions<T>,
): Promise<T> {
  const { operation, spinner, wasSpinning } = {
    __proto__: null,
    ...options,
  } as WithSpinnerRestoreOptions<T>

  try {
    return await operation()
  } finally {
    if (spinner && wasSpinning) {
      spinner.start()
    }
  }
}

/**
 * Configuration options for `withSpinnerSync()` helper.
 * @template T - Return type of the sync operation
 */
export type WithSpinnerSyncOptions<T> = {
  /** Message to display while the spinner is running */
  message: string
  /** Synchronous function to execute while spinner is active */
  operation: () => T
  /**
   * Optional spinner instance to use.
   * If not provided, operation runs without spinner.
   */
  spinner?: Spinner | undefined
  /**
   * Optional spinner options to apply during the operation.
   * These options will be pushed when the operation starts and popped when it completes.
   * Supports color and shimmer configuration.
   */
  withOptions?: Partial<Pick<SpinnerOptions, 'color' | 'shimmer'>> | undefined
}

/**
 * Execute a synchronous operation with spinner lifecycle management.
 * Ensures `spinner.stop()` is always called via try/finally, even if the operation throws.
 * Provides safe cleanup and consistent spinner behavior for sync operations.
 *
 * @template T - Return type of the operation
 * @param options - Configuration object
 * @param options.message - Message to display while spinner is running
 * @param options.operation - Synchronous function to execute
 * @param options.spinner - Optional spinner instance (if not provided, no spinner is used)
 * @returns Result of the operation
 * @throws Re-throws any error from operation after stopping spinner
 *
 * @example
 * ```ts
 * import { Spinner, withSpinnerSync } from '@socketsecurity/lib/spinner'
 *
 * const spinner = Spinner()
 *
 * const result = withSpinnerSync({
 *   message: 'Processing…',
 *   operation: () => {
 *     return processDataSync()
 *   },
 *   spinner
 * })
 * ```
 */
export function withSpinnerSync<T>(options: WithSpinnerSyncOptions<T>): T {
  const { message, operation, spinner, withOptions } = {
    __proto__: null,
    ...options,
  } as WithSpinnerSyncOptions<T>

  if (!spinner) {
    return operation()
  }

  // Save current options if we're going to change them
  const savedColor =
    withOptions?.color !== undefined ? spinner.color : undefined
  const savedShimmerState =
    withOptions?.shimmer !== undefined ? spinner.shimmerState : undefined

  // Apply temporary options
  if (withOptions?.color !== undefined) {
    spinner.color = toRgb(withOptions.color)
  }
  if (withOptions?.shimmer !== undefined) {
    if (typeof withOptions.shimmer === 'string') {
      spinner.updateShimmer({ dir: withOptions.shimmer })
    } else {
      spinner.setShimmer(withOptions.shimmer)
    }
  }

  spinner.start(message)
  try {
    return operation()
  } finally {
    spinner.stop()
    // Restore previous options
    if (savedColor !== undefined) {
      spinner.color = savedColor
    }
    if (withOptions?.shimmer !== undefined) {
      if (savedShimmerState) {
        spinner.setShimmer({
          color: savedShimmerState.color as any,
          dir: savedShimmerState.mode,
          speed: savedShimmerState.speed,
        })
      } else {
        spinner.disableShimmer()
      }
    }
  }
}
