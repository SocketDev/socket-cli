import { vi } from 'vitest'

import { input, select } from '../src/utils/prompts.mts'

// Wizard prompts, as far as answerPrompts matches them.
export const BUILD_QUESTION =
  'Build project before reachability analysis? Note: A failed build fails the scan.'
export const JDK_PROMPT = 'What JDK should reachability analysis use?'
export const JDK_QUESTION = 'Use a different Java for reachability analysis?'
export const RUNTIME_PROMPT = 'Which .NET runtime?'
export const RUNTIME_QUESTION =
  'Start the reachability analysis of a framework-dependent .NET build on a given runtime?'

type Prompt = {
  choices?: ReadonlyArray<{ description?: unknown; name?: unknown }> | undefined
  default?: unknown
  message: string
  validate?: ((value: string) => unknown) | undefined
}

// For a test that mocks src/utils/prompts.mts.
// Answers each prompt whose message starts with a key of `answers` with its
// value, and every other prompt with its default. Records every prompt's
// message, and each answered prompt under its key.
export function answerPrompts(answers: Record<string, unknown> = {}): {
  asked: Record<string, Prompt[]>
  messages: string[]
  // The defaults the prompts answered under `key` showed.
  // The description of the "no" choice of each prompt answered under `key`.
  noChoice: (key: string) => unknown[]
  shown: (key: string) => unknown[]
} {
  const asked: Record<string, Prompt[]> = {}
  const messages: string[] = []
  const answer = (prompt: Prompt): any => {
    messages.push(prompt.message)
    const key = Object.keys(answers).find(k => prompt.message.startsWith(k))
    if (key === undefined) {
      return prompt.default ?? ''
    }
    ;(asked[key] ??= []).push(prompt)
    return answers[key]
  }
  vi.mocked(input).mockImplementation(async prompt => answer(prompt))
  vi.mocked(select).mockImplementation(async prompt => answer(prompt))
  return {
    asked,
    messages,
    noChoice: key =>
      (asked[key] ?? []).map(
        prompt =>
          prompt.choices?.find(choice => choice.name === 'no')?.description,
      ),
    shown: key => (asked[key] ?? []).map(prompt => prompt.default),
  }
}
