/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-npx-dlx -- product feature name / command wrapping npx; the literal is intentional. */

import { readFileSync } from "node:fs";

import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";
const logger = getDefaultLogger();

export function checkSocketWrapperSetup(file: string): boolean {
  let fileContent: string;
  try {
    fileContent = readFileSync(file, "utf8");
  } catch {
    // File may have been deleted or become unreadable.
    return false;
  }

  const linesWithSocketAlias = fileContent
    .split("\n")
    .filter((l) => l === 'alias npm="socket npm"' || l === 'alias npx="socket npx"');

  if (linesWithSocketAlias.length) {
    logger.log(`The Socket npm/npx wrapper is set up in your bash profile (${file}).`);
    logger.log("");
    logger.log(
      `If you haven't already since enabling; Restart your terminal or run this command to activate it in the current session:`,
    );
    logger.log("");
    logger.log(`    source ${file}`);
    logger.log("");

    return true;
  }
  return false;
}
