// Canonical test-fixture identity constants.
//
// All hook tests that need a fake human git identity import from here
// so the values stay consistent across the suite. RFC 2606 reserves
// `example.com` for documentation / testing — safe to hardcode.
//
// Three constants cover every use-case:
//   TEST_USER_NAME   — display name (GIT_AUTHOR_NAME / commit --author)
//   TEST_USER_EMAIL  — external / personal email (GIT_AUTHOR_EMAIL)
//   TEST_SOCKET_EMAIL — socket.dev alias email (identity allowlist tests)

export const TEST_USER_NAME = 'Test User'
export const TEST_USER_EMAIL = 'test-email@example.com'
export const TEST_SOCKET_EMAIL = 'test-email@socket.dev'
