/*
 * Local prompt adapter copied narrowly from @socketsecurity/registry 1.1.17
 * (lib/prompts.js). Copyright (c) 2024 Socket Inc., MIT License.
 * The prompt implementations remain the bundled @inquirer modules; only the
 * Socket context, spinner lifecycle, abort behavior, and result normalization
 * are kept here.
 */

import confirmPrompt from '@inquirer/confirm'
import inputPrompt from '@inquirer/input'
import passwordPrompt from '@inquirer/password'
import selectPrompt, { Separator as InquirerSeparator } from '@inquirer/select'

import spinner from './spinner.mts'

type PromptContext = { signal?: AbortSignal; spinner?: typeof spinner }
type PromptSeparator = InstanceType<typeof InquirerSeparator>
type PromptOptions<Value = unknown> = {
  message?: string
  choices?: ReadonlyArray<string | Choice<Value> | PromptSeparator>
  [key: string]: unknown
}

export type Choice<Value> = {
  value: Value
  disabled?: boolean | string
  description?: string
  name?: string
  short?: string
  type?: never
}

const abortController = new AbortController()
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => abortController.abort())
}
process.once('exit', () => abortController.abort())

type PromptImplementation<Result> = (
  config: never,
  context?: never,
) => Promise<Result>

function wrapPrompt<Result>(prompt: PromptImplementation<Result>) {
  return async (
    config: PromptOptions,
    context?: PromptContext,
  ): Promise<Result | undefined> => {
    const { spinner: activeSpinner = spinner, ...contextWithoutSpinner } =
      context ?? {}
    const promptContext = {
      signal: abortController.signal,
      ...contextWithoutSpinner,
    }
    const wasSpinning = !!activeSpinner?.isSpinning
    activeSpinner?.stop()
    let result: Result | undefined
    try {
      result = await (
        prompt as unknown as (
          config: PromptOptions,
          context?: PromptContext,
        ) => Promise<Result>
      )(config, promptContext)
    } catch (error) {
      if (error instanceof TypeError) {
        throw error
      }
    }
    if (wasSpinning) {
      activeSpinner?.start()
    }
    return typeof result === 'string' ? (result.trim() as Result) : result
  }
}

export const confirm = wrapPrompt(confirmPrompt) as (
  config: PromptOptions<boolean>,
  context?: PromptContext,
) => Promise<boolean | undefined>
export const input = wrapPrompt(inputPrompt) as (
  config: PromptOptions<string>,
  context?: PromptContext,
) => Promise<string | undefined>
export const password = wrapPrompt(passwordPrompt) as (
  config: PromptOptions<string>,
  context?: PromptContext,
) => Promise<string | undefined>
export const select = wrapPrompt(selectPrompt) as unknown as <Value = string>(
  config: PromptOptions<Value>,
  context?: PromptContext,
) => Promise<Value | undefined>
export { InquirerSeparator as Separator }
