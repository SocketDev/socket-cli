/*
 * @file Hand-authored declarations for plan-setup-tools.mjs — the decision
 *   core stays plain .mjs because the fleet setup action runs it on the
 *   runner's system Node before any install exists, so the typed test surface
 *   is declared here.
 */

export type SfwFlavor = 'enterprise' | 'free'

export type SfwShape = 'canonical' | 'legacy'

export type SfwProbeClass = '5xx' | 'ok' | 'sku'

export interface SfwFlavorSelection {
  flavor: SfwFlavor
  repo: string
}

export interface SfwSelection {
  entryPath: string
  flavor: SfwFlavor
  ns: string
  repo: string
  shape: SfwShape
  versionPath: string
}

export interface SfwFallbackSelection {
  entryPath: string
  flavor: 'free'
  repo: string
  versionPath: string
}

export interface ToolsProbe {
  (toolsFile: string, keys: readonly string[]): boolean
}

export declare function toolsNamespace(hasToolsKey: boolean): string

export declare function sfwShape(hasCanonicalEntry: boolean): SfwShape

export declare function selectSfwFlavor(
  socketApiToken: string,
): SfwFlavorSelection

export declare function sfwEntryPath(shape: string, flavor: string): string

export declare function sfwVersionPath(shape: string, flavor: string): string

export declare function resolveSfwSelection(options: {
  probe: ToolsProbe
  socketApiToken: string
  toolsFile: string
}): SfwSelection

export declare function fallbackSfwSelection(
  shape: string,
): SfwFallbackSelection

export declare function classifySfwProbe(probeOutput: string): SfwProbeClass

export declare function planChecksumsEnvExports(options: {
  extendedEnv: string
  toolsDest: string
}): string[]

export declare function planPnpmEnvExports(options: {
  asset: string
  extendedEnv: string
  integrity: string
  platform: string
  pnpmBin: string
  pnpmDir: string
  version: string
}): string[]

export declare function planSfwEnvExports(options: {
  asset: string
  extendedEnv: string
  flavor: string
  integrity: string
  platform: string
  sfwBin: string
  socketApiToken: string
  version: string
}): string[]
