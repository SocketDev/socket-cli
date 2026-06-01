/**
 * @file Build output formatting utilities Centralized output formatting for
 *   build script.
 */

import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

const logger = getDefaultLogger();
/**
 * Print error with instructions.
 */
export function printError(title: string, message: string, instructions: string[] = []): void {
  logger.error("");
  logger.error("❌", title);
  logger.error("");
  logger.error(message);
  if (instructions.length > 0) {
    logger.error("");
    logger.error("What to do:");
    for (let i = 0, { length } = instructions; i < length; i += 1) {
      const instruction = instructions[i];
      logger.error(`  • ${instruction}`);
    }
  }
  logger.error("");
}

/**
 * Print section header.
 */
export function printHeader(title: string): void {
  logger.log("");
  logger.log("━".repeat(60));
  logger.log(`  ${title}`);
  logger.log("━".repeat(60));
  logger.log("");
}

/**
 * Print info message.
 */
function printInfo(message: string): void {
  logger.log(`ℹ️  ${message}`);
}

/**
 * Print step with description.
 */
function printStep(step: number, total: number, description: string): void {
  logger.log(`[${step}/${total}] ${description}`);
}

/**
 * Print success message.
 */
export function printSuccess(message: string): void {
  logger.log(`✅ ${message}`);
}

/**
 * Print warning with suggestions.
 */
function printWarning(title: string, message: string, suggestions: string[] = []): void {
  logger.warn("");
  logger.warn("⚠️ ", title);
  logger.warn("");
  logger.warn(message);
  if (suggestions.length > 0) {
    logger.warn("");
    logger.warn("Suggestions:");
    for (let i = 0, { length } = suggestions; i < length; i += 1) {
      const suggestion = suggestions[i];
      logger.warn(`  • ${suggestion}`);
    }
  }
  logger.warn("");
}
