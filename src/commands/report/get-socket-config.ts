import { betterAjvErrors } from '@apideck/better-ajv-errors'

import { SocketValidationError, readSocketConfig } from '@socketsecurity/config'

import { InputError } from '../../utils/errors.ts'

export async function getSocketConfig(absoluteConfigPath: string) {
  const socketConfig = await readSocketConfig(absoluteConfigPath).catch(
    (cause: unknown) => {
      if (
        cause &&
        typeof cause === 'object' &&
        cause instanceof SocketValidationError
      ) {
        // Inspired by workbox-build:
        // https://github.com/GoogleChrome/workbox/blob/95f97a207fd51efb3f8a653f6e3e58224183a778/packages/workbox-build/src/lib/validate-options.ts#L68-L71
        const betterErrors = betterAjvErrors({
          basePath: 'config',
          data: cause.data,
          errors: cause.validationErrors,
          schema: cause.schema as Parameters<
            typeof betterAjvErrors
          >[0]['schema']
        })
        throw new InputError(
          'The socket.yml config is not valid',
          betterErrors
            .map(
              err =>
                `[${err.path}] ${err.message}.${err.suggestion ? err.suggestion : ''}`
            )
            .join('\n')
        )
      } else {
        throw new Error('Failed to read socket.yml config', { cause })
      }
    }
  )

  return socketConfig
}
