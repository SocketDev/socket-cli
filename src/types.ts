export type StringKeyValueObject = { [key: string]: string }

export type OutputKind = 'json' | 'markdown' | 'text'

// CResult is akin to the "Result" or "Outcome" or "Either" pattern.
// Main difference might be that it's less strict about the error side of
// things, but still assumes a message is returned explaining the error.
// "CResult" is easier to grep for than "result". Short for CliJsonResult.
export type CResult<T> =
  | {
      ok: true
      data: T
      // The message prop may contain warnings that we want to convey.
      message?: string
    }
  | {
      ok: false
      // This should be set to process.exitCode if this
      // payload is actually displayed to the user.
      // Defaults to 1 if not set.
      code?: number
      // Short message, for non-json this would show in
      // the red banner part of an error message.
      message: string
      // Full explanation. Shown after the red banner of
      // a non-json error message. Optional.
      cause?: string
      // If set, this may conform to the actual payload.
      data?: unknown
    }
