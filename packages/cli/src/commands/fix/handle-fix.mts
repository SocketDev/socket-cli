/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
import { joinAnd } from "@socketsecurity/lib-stable/arrays/join";
import { debug, debugDir } from "@socketsecurity/lib-stable/debug/output";
import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

import { coanaFix } from "./coana-fix.mts";
import { outputFixResult } from "./output-fix-result.mts";
import { convertCveToGhsa } from "../../util/cve-to-ghsa.mts";
import { convertPurlToGhsas } from "../../util/purl/to-ghsa.mts";

import type { FixConfig } from "./types.mts";
import type { OutputKind } from "../../types.mts";
import type { Remap } from "@socketsecurity/lib-stable/objects/types";
const logger = getDefaultLogger();

const GHSA_FORMAT_REGEXP = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const CVE_FORMAT_REGEXP = /^CVE-\d{4}-\d{4,}$/;

type HandleFixConfig = Remap<
  FixConfig & {
    applyFixes: boolean;
    ghsas: string[];
    orgSlug: string;
    outputKind: OutputKind;
    unknownFlags: string[];
    outputFile: string;
    minimumReleaseAge: string;
    silence: boolean;
  }
>;

/**
 * Converts mixed CVE/GHSA/PURL IDs to GHSA IDs only. Filters out invalid IDs
 * and logs conversion results.
 */
export async function convertIdsToGhsas(ids: string[]): Promise<string[]> {
  debug(`Converting ${ids.length} IDs to GHSA format`);
  debugDir({ ids });

  const validGhsas: string[] = [];
  const errors: string[] = [];

  for (let i = 0, { length } = ids; i < length; i += 1) {
    const id = ids[i]!;
    const trimmedId = id.trim();

    if (trimmedId.startsWith("GHSA-")) {
      // Already a GHSA ID, validate format
      if (GHSA_FORMAT_REGEXP.test(trimmedId)) {
        validGhsas.push(trimmedId);
      } else {
        errors.push(`Invalid GHSA format: ${trimmedId}`);
      }
    } else if (trimmedId.startsWith("CVE-")) {
      // Convert CVE to GHSA
      if (!CVE_FORMAT_REGEXP.test(trimmedId)) {
        errors.push(`Invalid CVE format: ${trimmedId}`);
        continue;
      }

      const conversionResult = await convertCveToGhsa(trimmedId);
      if (conversionResult.ok) {
        validGhsas.push(conversionResult.data);
        logger.info(`Converted ${trimmedId} to ${conversionResult.data}`);
      } else {
        errors.push(`${trimmedId}: ${conversionResult.message}`);
      }
    } else if (trimmedId.startsWith("pkg:")) {
      // Convert PURL to GHSAs
      const conversionResult = await convertPurlToGhsas(trimmedId);
      if (conversionResult.ok && conversionResult.data.length) {
        validGhsas.push(...conversionResult.data);
        const displayGhsas =
          conversionResult.data.length > 3
            ? `${conversionResult.data.slice(0, 3).join(", ")} … and ${conversionResult.data.length - 3} more`
            : joinAnd(conversionResult.data);
        logger.info(
          `Converted ${trimmedId} to ${conversionResult.data.length} GHSA(s): ${displayGhsas}`,
        );
      } else {
        errors.push(`${trimmedId}: ${conversionResult.message || "No GHSAs found"}`);
      }
    } else {
      // Neither CVE, GHSA, nor PURL, skip
      errors.push(`Unsupported ID format (expected CVE, GHSA, or PURL): ${trimmedId}`);
    }
  }

  if (errors.length) {
    logger.warn(
      `Skipped ${errors.length} invalid IDs:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    debugDir({ errors });
  }

  debug(`Converted to ${validGhsas.length} valid GHSA IDs`);
  debugDir({ validGhsas });

  return validGhsas;
}

export async function handleFix({
  all,
  applyFixes,
  autopilot,
  coanaVersion,
  cwd,
  debug: debugFlag,
  disableExternalToolChecks,
  disableMajorUpdates,
  ecosystems,
  exclude,
  ghsas,
  include,
  minSatisfying,
  minimumReleaseAge,
  orgSlug,
  outputFile,
  outputKind,
  prCheck,
  prLimit,
  rangeStyle,
  showAffectedDirectDependencies,
  silence,
  spinner,
  unknownFlags,
}: HandleFixConfig) {
  debug(`Starting fix command for ${orgSlug}`);
  debugDir({
    all,
    applyFixes,
    autopilot,
    coanaVersion,
    cwd,
    debug: debugFlag,
    disableExternalToolChecks,
    disableMajorUpdates,
    ecosystems,
    exclude,
    ghsas,
    include,
    minSatisfying,
    minimumReleaseAge,
    outputFile,
    outputKind,
    prCheck,
    prLimit,
    rangeStyle,
    showAffectedDirectDependencies,
    unknownFlags,
  });

  await outputFixResult(
    await coanaFix({
      all,
      applyFixes,
      autopilot,
      coanaVersion,
      cwd,
      debug: debugFlag,
      disableExternalToolChecks,
      disableMajorUpdates,
      ecosystems,
      exclude,
      // Convert mixed CVE/GHSA/PURL inputs to GHSA IDs only.
      ghsas: await convertIdsToGhsas(ghsas),
      include,
      minimumReleaseAge,
      minSatisfying,
      orgSlug,
      outputFile,
      outputKind,
      prCheck,
      prLimit,
      rangeStyle,
      showAffectedDirectDependencies,
      silence,
      spinner,
      unknownFlags,
    }),
    outputKind,
  );
}
