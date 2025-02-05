import util from 'node:util';
import fs from 'node:fs';
import child_process from 'node:child_process';
import path from 'node:path';

import meow from 'meow'
import { getFlagListOutput } from '../../utils/output-formatting.ts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

type ListDescription = string | { description: string, type?: string, default?: string }

const execp = util.promisify(child_process.exec);
const renamep = util.promisify(fs.rename);

const description = 'Generate a "Software Bill of Materials" (`pom.xml`) from Scala\'s `build.sbt` file'

const sbomFlags: Record<string, ListDescription> = {
  bin: {
    type: 'string',
    default: 'sbt',
    description: 'Location of sbt binary to use'
  },
  out: {
    type: 'string',
    default: './socket.pom.xml',
    description: 'Path of output file; where to store the resulting sbom, see also --stdout'
  },
  stdout: {
    type: 'boolean',
    description: 'Print resulting pom.xml to stdout (supersedes --out)'
  },
  sbtOpts: {
    type: 'string',
    default: '',
    description: 'Additional options to pass on to sbt, as per `sbt --help`'
  },
  verbose: {
    type: 'boolean',
    description: 'Print debug messages'
  }
}

const help = (name:string, flags: Record<string, ListDescription>) => `
  Usage
    $ ${name} [--sbt=path/to/sbt/binary] [--out=path/to/result] FILE|DIR

  Options
    ${getFlagListOutput(flags, 6)}

  Uses \`sbt makePom\` to generate a \`pom.xml\` from your \`build.sbt\` file.
  This xml file is the SBOM ("Software Bill of Materials") like a package.json
  for Node.js or requirements.txt for PyPi, but specifically for Scala.

  There are some caveats with \`build.sbt\` to \`pom.xml\` conversion:

  - the xml is exported as socket.pom.xml as to not confuse existing build tools
    but it will first hit your /target/sbt<version> folder (as a different name)

  - the pom.xml format (standard by Scala) does not support certain sbt features
    - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
    - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

  - it uses your sbt settings and local configuration verbatim

  - it can only export one target per run, so if you have multiple targets like
    development and production, you must run them separately.

  You can optionally configure the path to the \`sbt\` bin to invoke.

  Examples

    $ ${name} ./build.sbt
    $ ${name} --bin=/usr/bin/sbt ./build.sbt
`;

export const scala: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} scala`
    // note: meow will exit if it prints the --help screen
    const cli = meow(
      help(name, sbomFlags),
      {
        argv: argv.length === 0 ? ['--help'] : argv,
        description,
        importMeta
      }
    )

    const target = cli.input[0]

    if (!target) {
      // will exit.
      new Spinner().start('Parsing...').error(`Failure: Missing FILE|DIR argument. See \`${name} --help\` for details.`);
      process.exit(1);
    }

    if (cli.input.length > 1) {
      // will exit.
      new Spinner().start('Parsing...').error(`Failure: Can only accept one FILE or DIR, received ${cli.input.length} (make sure to escape spaces!). See \`${name} --help\` for details.`);
      process.exit(1);
    }

    let bin:string = 'sbt'
    if (cli.flags['bin']) {
      bin = cli.flags['bin'] as string
    }

    let out:string = './socket.pom.xml'
    if (cli.flags['out']) {
      out = cli.flags['out'] as string
    }
    if (cli.flags['stdout']) {
      out = '-';
    }

    // TODO: we can make `-` (accept from stdin) work by storing it into /tmp
    if (target === '-') {
      new Spinner().start('Parsing...').error(`Failure: Currently source code from stdin is not supported. See \`${name} --help\` for details.`);
      process.exit(1);
    }

    const verbose = cli.flags['verbose'] as boolean ?? false;

    let sbtOpts:Array<string> = [];
    if (cli.flags['sbtOpts']) {
      sbtOpts = (cli.flags['sbtOpts'] as string).split(' ').map(s => s.trim()).filter(Boolean)
    }

    await startConversion(target, bin, out, verbose, sbtOpts);
  }
}

async function startConversion(target: string, bin: string, out: string, verbose: boolean, sbtOpts: Array<string>) {
  const spinner = new Spinner();

  const rbin = path.resolve(bin);
  const rtarget = path.resolve(target);
  const rout = out === '-' ? '-' : path.resolve(out);

  if (verbose){
    spinner.clear();
    console.log(`- Absolute bin path: \`${rbin}\``);
    console.log(`- Absolute target path: \`${rtarget}\``);
    console.log(`- Absolute out path: \`${rout}\``);
  }

  spinner.start(`Running sbt from \`${bin}\` on \`${target}\`...`)

  try {
    // We must now run sbt, pick the generated xml from the /target folder (the stdout should tell you the location upon success) and store it somewhere else.
    // TODO: Not sure what this somewhere else might be tbh.

    const output = await execp(bin +` makePom ${sbtOpts.join(' ')}`, {cwd: target || '.'});
    spinner.success();
    if (verbose) {
      console.group('sbt stdout:')
      console.log(output);
      console.groupEnd();
    }

    if (output.stderr) {
      spinner.error('There were errors while running sbt');
      // (In verbose mode, stderr was printed above, no need to repeat it)
      if (!verbose) console.error(output.stderr);
      process.exit(1);
    }

    const loc = output.stdout?.match(/Wrote (.*?.pom)\n/)?.[1]?.trim();
    if (!loc) {
      spinner.error('There were no errors from sbt but could not find the location of resulting .pom file either');
      process.exit(1);
    }

    // Move the pom file to ...? initial cwd? loc will be an absolute path, or dump to stdout
    if (out === '-') {
      spinner.start('Result:\n```').success();
      console.log(fs.readFileSync(loc, 'utf8'));
      console.log('```')
      spinner.start().success(`OK`);
    } else {
      if (verbose) {
        spinner.start(`Moving sbom file from \`${loc.replace(/^\/home\/[^\/]*?\//, '~/')}\` to \`${out}\``);
      } else {
        spinner.start('Moving output pom file');
      }
      // TODO: do we prefer fs-extra? renaming can be gnarly on windows and fs-extra's version is better
      await renamep(loc, out);
      spinner.success();
      spinner.start().success(`OK. File should be available in \`${out}\``);
    }
  } catch (e) {
    spinner.error('There was an unexpected error while running this')
    if (verbose) {
      console.log(e);
    }
    process.exit(1);
  }

}
