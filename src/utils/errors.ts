export class AuthError extends Error {}

export class InputError extends Error {
  public body: string | undefined

  constructor(message: string, body?: string) {
    super(message)

    this.body = body
  }
}

export function isErrnoException(
  value: unknown
): value is NodeJS.ErrnoException {
  if (!(value instanceof Error)) {
    return false
  }
  return (value as NodeJS.ErrnoException).code !== undefined
}
