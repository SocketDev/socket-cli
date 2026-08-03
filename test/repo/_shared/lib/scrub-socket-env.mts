/**
 * @file Scrubs ambient Socket credentials from the test process env. The
 *   integration corpus spawns the real CLI, and spawned children inherit
 *   `process.env` — a developer's exported `SOCKET_API_KEY` (or any token
 *   alias) outranks the per-test `--config {"apiToken":...}` override, so an
 *   authenticated shell silently rewires token-resolution tests and can send
 *   real, authenticated requests to the live API. CI runners carry none of
 *   these, so scrubbing makes local runs match the gate. Tests that exercise
 *   env-token resolution set the variable explicitly per spawn and are
 *   unaffected.
 */
import process from 'node:process'

const AMBIENT_SOCKET_ENV_VARS = [
  // Token aliases recognized by lib-stable getSocketApiToken().
  'SOCKET_API_KEY',
  'SOCKET_API_TOKEN',
  'SOCKET_CLI_API_KEY',
  'SOCKET_CLI_API_TOKEN',
  'SOCKET_SECURITY_API_KEY',
  'SOCKET_SECURITY_API_TOKEN',
  // Whole-config + default-org overrides that would shadow per-test --config.
  'SOCKET_CONFIG',
  'SOCKET_CLI_CONFIG',
  'SOCKET_ORG_SLUG',
  'SOCKET_CLI_ORG_SLUG',
]

export function scrubAmbientSocketEnv(): void {
  for (const name of AMBIENT_SOCKET_ENV_VARS) {
    delete process.env[name]
  }
}
