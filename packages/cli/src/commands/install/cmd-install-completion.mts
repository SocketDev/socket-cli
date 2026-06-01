import { handleInstallCompletion } from "./handle-install-completion.mts";
import { outputDryRunWrite } from "../../util/dry-run/output.mts";
import { defineFlags } from "../../meow.mts";
import { commonFlags } from "../../flags.mts";
import { meowOrExit } from "../../util/cli/with-subcommands.mjs";
import { getFlagListOutput } from "../../util/output/formatting.mts";

import type { CliCommandContext } from "../../util/cli/with-subcommands.mjs";
import type { MeowFlags } from "../../flags.mts";

const config = {
  commandName: "completion",
  description: "Install bash completion for Socket CLI",
  flags: defineFlags({
    ...commonFlags,
  }),
  help: (command: string, config: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [NAME=socket]

    Installs bash completion for the Socket CLI. This will:
    1. Source the completion script in your current shell
    2. Add the source command to your ~/.bashrc if it's not already there

    This command will only setup tab completion, nothing else.

    Afterwards you should be able to type \`socket \` and then press tab to
    have bash auto-complete/suggest the sub/command or flags.

    Currently only supports bash.

    The optional name argument allows you to enable tab completion on a command
    name other than "socket". Mostly for debugging but also useful if you use a
    different alias for socket on your system.

    Options
      ${getFlagListOutput(config.flags)}

    Examples

      $ ${command}
      $ ${command} sd
      $ ${command} ./sd
  `,
  hidden: false,
};

export const cmdInstallCompletion = {
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
  const targetName = cli.input[0] || "socket";

  if (dryRun) {
    // Runtime read so tests that mutate process.env['HOME'] pick up changes.
    const bashRcPath = `${process.env["HOME"]}/.bashrc`;
    outputDryRunWrite(bashRcPath, `install bash completion for "${targetName}"`, [
      "Add completion script source command to ~/.bashrc",
      "Enable tab completion in current shell",
    ]);
    return;
  }

  await handleInstallCompletion(String(targetName));
}
