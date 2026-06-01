/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
import { errorMessage } from "@socketsecurity/lib-stable/errors";
import { safeReadFile } from "@socketsecurity/lib-stable/fs/read-file";
import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";
import { spawn } from "@socketsecurity/lib-stable/process/spawn/child";
import { getDefaultSpinner } from "@socketsecurity/lib-stable/spinner/default";

import type { ManifestResult } from "./output-manifest.mts";
import type { CResult, OutputKind } from "../../types.mts";
const logger = getDefaultLogger();

export async function convertSbtToMaven({
  bin,
  cwd,
  out,
  outputKind = "text",
  sbtOpts,
  verbose,
}: {
  bin: string;
  cwd: string;
  out: string;
  outputKind?: OutputKind | undefined;
  sbtOpts: string[];
  verbose: boolean;
}): Promise<CResult<ManifestResult>> {
  const isTextMode = outputKind === "text";

  if (isTextMode) {
    logger.group("sbt2maven:");
    logger.info(`- executing: \`${bin}\``);
    logger.info(`- src dir: \`${cwd}\``);
    logger.groupEnd();
  }

  const spinner = isTextMode ? getDefaultSpinner() : undefined;
  try {
    spinner?.start(`Converting sbt to maven from \`${bin}\` on \`${cwd}\`...`);

    // Run sbt with the init script we provide which should yield zero or more
    // pom files. We have to figure out where to store those pom files such that
    // we can upload them and predict them through the GitHub API. We could do a
    // .socket folder. We could do a socket.pom.gz with all the poms, although
    // I'd prefer something plain-text if it is to be committed.
    const output = await spawn(bin, ["makePom", ...sbtOpts], { cwd });

    spinner?.stop();

    if (verbose && isTextMode) {
      logger.group("[VERBOSE] sbt stdout:");
      logger.log(output);
      logger.groupEnd();
    }
    if (output.stderr) {
      if (isTextMode) {
        process.exitCode = 1;
        logger.fail("There were errors while running sbt");
        // (In verbose mode, stderr was printed above, no need to repeat it)
        if (!verbose) {
          logger.group("[VERBOSE] stderr:");
          logger.error(output.stderr);
          logger.groupEnd();
        }
      }
      return {
        ok: false,
        message: "There were errors while running sbt",
        cause: output.stderr,
      };
    }
    const poms: string[] = [];
    const stdoutStr = output.stdout;
    stdoutStr.replace(/Wrote (.*?.pom)\n/g, (_all: string, fn: string) => {
      poms.push(fn);
      return fn;
    });
    if (!poms.length) {
      const message =
        "There were no errors from sbt but it seems to not have generated any poms either";
      if (isTextMode) {
        process.exitCode = 1;
        logger.fail(message);
      }
      return {
        ok: false,
        message,
      };
    }
    // Handle stdout output: Only supported for single file output.
    // Note: Multiple file stdout output could be supported in the future with separators
    // or a flag to select specific files, but currently errors out for clarity.
    if (out === "-" && poms.length === 1 && isTextMode) {
      logger.log("Result:\n```");
      logger.log(await safeReadFile(poms[0]!));
      logger.log("```");
      logger.success("OK");
    } else if (out === "-") {
      const message = "Requested output target was stdout but there are multiple generated files";
      if (isTextMode) {
        process.exitCode = 1;
        logger.error("");
        logger.fail(message);
        logger.error("");
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- callback uses expression body
        poms.forEach((fn) => logger.info("-", fn));
        if (poms.length > 10) {
          logger.error("");
          logger.fail(message);
        }
        logger.error("");
        logger.info("Exiting now…");
      }
      return {
        ok: false,
        message,
        data: { files: poms },
      };
    } else if (isTextMode) {
      logger.success(`Generated ${poms.length} pom files`);
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- callback uses expression body
      poms.forEach((fn) => logger.log("-", fn));
      logger.success("OK");
    }

    return {
      ok: true,
      data: {
        files: poms,
        type: "sbt",
        success: true,
      },
    };
  } catch (e) {
    const summary =
      "There was an unexpected error while running this" +
      (verbose ? "" : " (use --verbose for details)");

    if (isTextMode) {
      process.exitCode = 1;
      spinner?.stop();
      logger.fail(summary);
      if (verbose) {
        logger.group("[VERBOSE] error:");
        logger.log(e);
        logger.groupEnd();
      }
    }

    return {
      ok: false,
      message: summary,
      cause: errorMessage(e),
    };
  }
}
