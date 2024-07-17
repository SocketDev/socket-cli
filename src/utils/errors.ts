export class AuthError extends Error {}

export class InputError extends Error {
  public body: string | undefined

  constructor(message: string, body?: string) {
    super(message)

    this.body = body
  }
}
