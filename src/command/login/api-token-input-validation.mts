export type ApiTokenInput =
  | { kind: 'cancelled' }
  | { kind: 'blank' }
  | { kind: 'supplied'; token: string }

export function classifyLoginTokenInput(
  input: string | undefined,
): ApiTokenInput {
  if (input === undefined) {
    return { kind: 'cancelled' }
  }
  if (input.trim().length === 0) {
    return { kind: 'blank' }
  }
  return { kind: 'supplied', token: input }
}
