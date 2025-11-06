/**
 * @fileoverview Maintained Node.js versions without external dependencies.
 */

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ObjectFreeze = Object.freeze

// Manually maintained Node.js version list.
// https://nodejs.org/en/about/previous-releases#looking-for-latest-release-of-a-version-branch
//
// Updated October 16th, 2025.
// - v25: 25.0.0 (Current)
// - v24: 24.10.0 (Current)
// - v22: 22.20.0 (Active LTS)
// - v20: 20.19.5 (Maintenance LTS)
// - v18: 18.20.8 (End-of-life)
const next = '25.0.0'
const current = '22.20.0'
const previous = '20.19.5'
const last = '18.20.8'

export default ObjectFreeze(
  Object.assign([last, previous, current, next], {
    current,
    last,
    next,
    previous,
  }),
) as readonly string[] & {
  current: string
  last: string
  next: string
  previous: string
}
