/*
 * @file Hand-authored declarations for verify-lib-floor.mjs — the floor
 *   check stays plain .mjs because the fleet install action runs it on
 *   whatever Node the runner provides, so the typed test surface is
 *   declared here.
 */

export interface Floor {
  minSource: string
  minVersion: string
}

export interface LibSelection {
  actualVersion: string
  libPkg: string
}

export interface VerificationPlan {
  exitCode: number
  stderrText: string
  stdoutText: string
}

export declare const HARDCODED_FLOOR: string

export declare const STABLE_PKG: string

export declare const LIB_PKG: string

export declare function isPlainSemver(value: string): boolean

export declare function semverLt(a: string, b: string): boolean

export declare function selectLibPackage(
  stableVersion: string,
  libVersion: string,
): LibSelection

export declare function chooseFloor(
  npmLatest: string,
  hardcodedFloor?: string | undefined,
): Floor

export declare function planVerification(options: {
  cwd: string
  hardcodedFloor?: string | undefined
  libVersion: string
  npmLatest: string
  stableVersion: string
}): VerificationPlan

export declare function probeInstalledVersion(
  pkgName: string,
  resolveFrom?: string | undefined,
): string

export declare function runVerify(
  options?:
    | {
        cwd?: string | undefined
        npmLatest?: string | undefined
        probe?: ((pkgName: string) => string) | undefined
        writeErr?: ((text: string) => void) | undefined
        writeOut?: ((text: string) => void) | undefined
      }
    | undefined,
): number
