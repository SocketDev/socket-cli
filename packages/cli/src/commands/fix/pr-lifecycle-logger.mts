/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-status-emoji -- TUI / custom output formatter; emojis are part of the visual contract. */

import colors from "yoctocolors-cjs";

import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";
const logger = getDefaultLogger();

type PrLifecycleEvent = "created" | "closed" | "failed" | "merged" | "superseded" | "updated";

/**
 * Log PR lifecycle events with consistent formatting and color-coding.
 *
 * @param event - The lifecycle event type.
 * @param prNumber - The pull request number.
 * @param ghsaId - The GHSA ID associated with the PR.
 * @param details - Optional additional details to include in the log message.
 */
export function logPrEvent(
  event: PrLifecycleEvent,
  prNumber: number,
  ghsaId: string,
  details?: string,
): void {
  const prRef = `PR #${prNumber}`;
  const detailsSuffix = details ? `: ${details}` : "";

  switch (event) {
    case "created":
      logger.success(`${colors.green("✓")} Created ${prRef} for ${ghsaId}${detailsSuffix}`);
      break;
    case "merged":
      logger.success(`${colors.green("✓")} Merged ${prRef} for ${ghsaId}${detailsSuffix}`);
      break;
    case "closed":
      logger.info(`${colors.blue("ℹ")} Closed ${prRef} for ${ghsaId}${detailsSuffix}`);
      break;
    case "updated":
      logger.info(`${colors.cyan("→")} Updated ${prRef} for ${ghsaId}${detailsSuffix}`);
      break;
    case "superseded":
      logger.warn(`${colors.yellow("⚠")} Superseded ${prRef} for ${ghsaId}${detailsSuffix}`);
      break;
    case "failed":
      logger.error(`${colors.red("✗")} Failed to create ${prRef} for ${ghsaId}${detailsSuffix}`);
      break;
  }
}
