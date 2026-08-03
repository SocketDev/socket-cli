/**
 * Socket Firewall (sfw) version getter function. Uses direct process.env access
 * so esbuild define can inline values. IMPORTANT: esbuild's define plugin can
 * only replace direct process.env['KEY'] references. If we imported from env
 * modules, esbuild couldn't inline the values at build time. This is critical
 * for embedding version info into the binary.
 *
 * Sfw ships as a GitHub binary (SocketDev/sfw-free), version like "v1.12.0",
 * used for both SEA builds and CLI dlx (the bundled binary, not an npm
 * install).
 */

import process from 'node:process'

/**
 * Get the GitHub release version for sfw.
 */
export function getSwfVersion(): string {
  const version = process.env['INLINED_SFW_VERSION']
  if (!version) {
    throw new Error(
      `process.env.INLINED_SFW_VERSION is empty at runtime; this value should be inlined at build time from bundle-tools.json tools.sfw.version (GitHub release tag) — rebuild socket-cli (\`pnpm run build:cli\`) or check that esbuild's define step ran`,
    )
  }
  return version
}
