/**
 * SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET environment variable.
 *
 * Client secret paired with SOCKET_OAUTH_INTROSPECTION_CLIENT_ID for the
 * `socket mcp` OAuth introspection call. Empty string when unset.
 *
 * Read lazily so tests that mutate process.env after module load see the latest
 * value.
 */

import process from "node:process";

export function getSocketOauthIntrospectionClientSecret(): string {
  return process.env["SOCKET_OAUTH_INTROSPECTION_CLIENT_SECRET"] ?? "";
}
