/**
 * Shadow binary link installation utilities for Socket CLI.
 *
 * Note: npm/npx now use Socket Firewall (sfw) directly via npm-cli.mts and npx-cli.mts.
 * pnpm and yarn also delegate to sfw via dlx.
 * These link functions are kept for backward compatibility with shadow pnpm/yarn bins.
 */

/**
 * Install pnpm shadow links.
 * pnpm no longer uses shadow binaries - delegates to Socket Firewall (sfw) via dlx.
 */
export async function installPnpmLinks(
  _shadowBinPath: string,
): Promise<string> {
  return 'pnpm'
}

/**
 * Install yarn shadow links.
 * yarn no longer uses shadow binaries - delegates to Socket Firewall (sfw) via dlx.
 */
export async function installYarnLinks(
  _shadowBinPath: string,
): Promise<string> {
  return 'yarn'
}
