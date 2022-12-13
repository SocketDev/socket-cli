export class AuthError extends Error {}

export class InputError extends Error {
  /**
   * @param {string} message
   * @param {string} [body]
   */
  constructor (message, body) {
    super(message)

    /** @type {string|undefined} */
    this.body = body
  }
}
