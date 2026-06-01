import path from "node:path";

import { handleScanConfig } from "./handle-scan-config.mts";
import { SOCKET_JSON } from "../../constants/paths.mts";
import { outputDryRunWrite } from "../../util/dry-run/output.mts";
import { defineFlags } from "../../meow.mts";
import { commonFlags } from "../../flags.mts";
import { meowOrExit } from "../../util/cli/with-subcommands.mjs";
import { getFlagListOutput } from "../../util/output/formatting.mts";

import type { CliCommandContext } from "../../util/cli/with-subcommands.mjs";
import type { MeowFlags } from "../../flags.mts";

const config = {
  commandName: "setup",
  description:
    "Start interactive configurator to customize default flag values for `socket scan` in this dir",
  flags: defineFlags({
    ...commonFlags,
    defaultOnReadError: {
      type: "boolean",
      description: `If reading the ${SOCKET_JSON} fails, just use a default config? Warning: This might override the existing json file!`,
    },
  }),
  help: (command: string, config: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

    Interactive configurator to create a local json file in the target directory
    that helps to set flag defaults for \`socket scan create\`.

    This helps to configure the (Socket reported) repo and branch names, as well
    as which branch name is the "default branch" (main, master, etc). This way
    you don't have to specify these flags when creating a scan in this dir.

    This generated configuration file will only be used locally by the CLI. You
    can commit it to the repo (useful for collaboration) or choose to add it to
    your .gitignore all the same. Only this CLI will use it.

    Examples

      $ ${command}
      $ ${command} ./proj
  `,
  hidden: false,
};

export const cmdScanSetup = {
  description: config.description,
  hidden: config.hidden,
  run,
};

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  });

  const dryRun = !!cli.flags["dryRun"];
  const { defaultOnReadError = false } = cli.flags;

  let [cwd = "."] = cli.input;
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd);

  if (dryRun) {
    const socketJsonPath = path.join(cwd, SOCKET_JSON);
    outputDryRunWrite(socketJsonPath, "create or update scan configuration", [
      "Set default repository name",
      "Set default branch name",
      "Configure scan options",
    ]);
    return;
  }

  await handleScanConfig(cwd, Boolean(defaultOnReadError));
}
