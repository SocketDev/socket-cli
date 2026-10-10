export const DEVICE_LOGIN_SCOPES = [
  'alerts:list',
  'dependencies:list',
  'diff-scans:list',
  'full-scans:create',
  'full-scans:list',
  'packages:list',
  'repo:list',
  'security-policy:read',
].join(' ')

export function createDeviceAuthorizationRequest(
  oauthBaseUrl: URL,
  clientId: string,
): { url: URL; body: URLSearchParams } {
  return {
    url: new URL('device/authorize', oauthBaseUrl),
    body: new URLSearchParams({
      client_id: clientId,
      scope: DEVICE_LOGIN_SCOPES,
    }),
  }
}
