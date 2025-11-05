/**
 * @fileoverview Helper types for working with generated OpenAPI types.
 */

/**
 * Extract the successful response type from an operation.
 * Maps to the data property of the success result.
 */
export type OpReturnType<T> = T extends {
  responses: {
    200?: { content?: { 'application/json': infer U } }
  }
}
  ? U
  : T extends {
        responses: {
          201?: { content?: { 'application/json': infer U } }
        }
      }
    ? U
    : T extends {
          responses: {
            204?: unknown
          }
        }
      ? undefined
      : unknown

/**
 * Extract the error response type from an operation.
 * Maps to the error structure of the error result.
 */
export type OpErrorType<T> = T extends {
  responses: infer R
}
  ? R extends Record<string | number, unknown>
    ? {
        [K in keyof R as K extends
          | 400
          | 401
          | 403
          | 404
          | 409
          | 422
          | 429
          | 500
          | 502
          | 503
          ? K
          : never]: R[K]
      }[keyof {
        [K in keyof R as K extends
          | 400
          | 401
          | 403
          | 404
          | 409
          | 422
          | 429
          | 500
          | 502
          | 503
          ? K
          : never]: R[K]
      }] extends { content?: { 'application/json': infer E } }
      ? E
      : { error?: string }
    : { error?: string }
  : { error?: string }
