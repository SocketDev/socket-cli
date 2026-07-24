/**
 * @file Frozen SEA base-asset pins for the socket-cli-controlled mirror.
 *   SocketDev/socket-btm is descoped and SocketDev/node-smol (its successor)
 *   has no releases yet, so the frozen base assets SEA builds depend on are
 *   mirrored into asset-carrier releases on SocketDev/socket-cli itself:
 *
 *   - base-assets-node-smol-20260418-50af4c8 — Node.js v25.9.0 minimal binaries,
 *     byte-identical mirror of socket-btm node-smol-20260418-50af4c8.
 *   - base-assets-binject-20260507-f1e66a5 — binject injector binaries,
 *     byte-identical mirror of socket-btm binject-20260507-f1e66a5 (the newest
 *     binject release with the complete 8-platform host set). Every mirrored
 *     asset was SHA-256-verified against the source release's checksums.txt and
 *     GitHub's asset digests. The pins below are the same checksums, checked in
 *     so downloads verify at point of use. The mirror tag for a socket-btm tool
 *     tag is always `base-assets-<tool-tag>`.
 */

/**
 * GitHub home of the mirrored base-asset releases.
 */
export const BASE_ASSETS_MIRROR_OWNER = 'SocketDev'
export const BASE_ASSETS_MIRROR_REPO = 'socket-cli'

/**
 * TRANSITION FALLBACK: the descoped source repo. Kept for one transition
 * release in case a mirror download fails; remove once the mirror has proven
 * itself through a full publish cycle.
 */
export const BASE_ASSETS_FALLBACK_OWNER = 'SocketDev'
export const BASE_ASSETS_FALLBACK_REPO = 'socket-btm'

/**
 * Frozen node-smol base version (tag suffix of node-smol-<version>). New SEA
 * binaries embed this base until SocketDev/node-smol ships its first release.
 */
export const NODE_SMOL_VERSION = '20260418-50af4c8'

/**
 * Frozen binject injector version (tag suffix of binject-<version>).
 */
export const BINJECT_VERSION = '20260507-f1e66a5'

/**
 * SHA-256 pins per source tool tag, keyed by release asset name. Values match
 * the source release's checksums.txt (and the mirror's GitHub asset digests —
 * proven identical at mirror time).
 */
export const BASE_ASSET_SHA256 = {
  __proto__: null,
  [`node-smol-${NODE_SMOL_VERSION}`]: {
    __proto__: null,
    'node-darwin-arm64':
      '0bd0ec2c798a7eafff35e15b73ceecf2d5aabb245725cfd90f218230b4064ca3',
    'node-darwin-x64':
      'd24ff4451a59eeddbdde789f774421d6eb27f0374b00cbe3e5e222880237cf8f',
    'node-linux-arm64':
      '9dcec7e6d4a2f0222fb46292910f6b26649a71900728ec01bec28991b5262d95',
    'node-linux-arm64-musl':
      'c089359789b7466a948c641b6ca00b7a83581174d5eb5dd687f1149689669dd8',
    'node-linux-x64':
      '48314e9ed1737d080708af347ee40cd2a9b7572205ca7669661a9a36b34d67fc',
    'node-linux-x64-musl':
      '9ad7cd82fc06dca5b902bdacaf28dc343b09dc8008ece12e4e973832e10254cc',
    'node-win-arm64.exe':
      '276c75151c7a6cd58d472b9cb0411a519e987a3a84aa8781aef95e72b3b18d72',
    'node-win-x64.exe':
      '4a2cb2c73ee5b26bc26e4c9025b22f02bbe066e7722def6d19e31f270a325a56',
  },
  [`binject-${BINJECT_VERSION}`]: {
    __proto__: null,
    'binject-darwin-arm64':
      'a1b88e5adf380ddd084c2977deb1fd583d37c0315b9590f09f73a419d9d2cb5d',
    'binject-darwin-x64':
      'e3f8592d95c162ab66f0c76aecabf8ecb7eef9ac4030169d9a503fa177ccebdc',
    'binject-linux-arm64':
      '87a51b02813c1ef94444cc3de689c3858a131cd9e4beb308cc4335b96c241d8c',
    'binject-linux-arm64-musl':
      '3d838b8ad44ef9132b75494089b930c6fe0c72a1ab104b1b10482ee2d08355a6',
    'binject-linux-x64':
      '0dc6d3bf1c1f75a9ac1fbe4afda9df6a541fe667a9348f8c191c3215fa1c6579',
    'binject-linux-x64-musl':
      'fa392d9486cb641189c213ed0d2ce7aa12daff7b729e8425fce5c591e2be3d87',
    'binject-win32-arm64.exe':
      '3f5fd172ab3913a7ceed3a2813a7c08ae9e4919226c9e6ca459c3525b988ddd6',
    'binject-win32-x64.exe':
      '3d28883dc18fbeb5b60805b74b9eb1f8a9f856e6847f85333b9dfeb1bb40743a',
  },
}
