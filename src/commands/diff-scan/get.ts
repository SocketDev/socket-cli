// import chalk from 'chalk'
// import meow from 'meow'
// import ora from 'ora'
// import fetch from 'node-fetch'
// import util from 'util'

// import { outputFlags } from '../../flags'
// // import {
// //   handleApiCall,
// //   handleUnsuccessfulApiResponse
// // } from '../../utils/api-helpers'
// import { printFlagList } from '../../utils/formatting'
// import { getDefaultKey } from '../../utils/sdk'

// import type { CliSubcommand } from '../../utils/meow-with-subcommands'
// import type { Ora } from 'ora'
// import { AuthError } from '../../utils/errors'

// export const get: CliSubcommand = {
//   description: 'Get a diff scan for an organization',
//   async run(argv, importMeta, { parentName }) {
//     const name = `${parentName} get`
//     const input = setupCommand(name, get.description, argv, importMeta)
//     if (input) {
//       const apiKey = getDefaultKey()
//       if(!apiKey){
//         throw new AuthError("User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.")
//       }
//       const spinnerText = 'Getting diff scan... \n'
//       const spinner = ora(spinnerText).start()
//       await getDiffScan(input.before, input.after, spinner, apiKey)
//     }
//   }
// }

// const getDiffScanFlags: { [key: string]: any } = {
//   before: {
//     type: 'string',
//     shortFlag: 'b',
//     default: '',
//     description: 'The full scan ID of the base scan'
//   },
//   after: {
//     type: 'string',
//     shortFlag: 'a',
//     default: '',
//     description: 'The full scan ID of the head scan'
//   },
//   preview: {
//     type: 'boolean',
//     shortFlag: 'p',
//     default: true,
//     description: 'A boolean flag to persist or not the diff scan result'
//   },
// }

// // Internal functions

// type CommandContext = {
//   outputJson: boolean
//   outputMarkdown: boolean
//   before: string
//   after: string
//   preview: boolean
// }

// function setupCommand(
//   name: string,
//   description: string,
//   argv: readonly string[],
//   importMeta: ImportMeta
// ): CommandContext | undefined {
//   const flags: { [key: string]: any } = {
//     ...outputFlags,
//     ...getDiffScanFlags
//   }

//   const cli = meow(
//     `
//     Usage
//       $ ${name}

//     Options
//       ${printFlagList(flags, 6)}

//     Examples
//       $ ${name}
//   `,
//     {
//       argv,
//       description,
//       importMeta,
//       flags
//     }
//   )

//   const {
//     json: outputJson,
//     markdown: outputMarkdown,
//     before,
//     after,
//     preview,
//   } = cli.flags

//   if (!before || !after) {
//     console.error(
//       `${chalk.bgRed.white('Input error')}: Please specify a before and after full scan ID. To get full scans IDs, you can run the command "socket scan list <your org slug>". \n`
//     )
//     cli.showHelp()
//     return
//   }

//   return <CommandContext>{
//     outputJson,
//     outputMarkdown,
//     before,
//     after,
//     preview
//   }
// }

// async function getDiffScan(
//   before: string,
//   after: string,
//   spinner: Ora, 
//   apiKey: string
// ): Promise<void> {
// //   const socketSdk = await setupSdk(apiKey)
// //   const result = await handleApiCall(
// //     socketSdk.getOrgFullScanList(orgSlug, input),
// //     'Listing scans'
// //   )

//   const response = await fetch(`https://api.socket.dev/v0/orgs/SocketDev/full-scans/diff?before=${before}&after=${after}&preview`, {
//     method: 'GET', 
//     headers: {
//         'Authorization': 'Basic ' + btoa(`${apiKey}:${apiKey}`)
//     }
//   });
//   const data = await response.json();

// //   if (!result.success) {
// //     handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
// //     return
// //   }
//   spinner.stop()

//   // before: dfc4cf0c-aefd-4081-9e4e-7385257f26e2
//   // after: 922e45f5-8a7b-4b16-95a5-e98ad00470f1

//   console.log(`\n Diff scan result: \n`)
// //   console.log(data);

//   console.log(util.inspect(data, {showHidden: false, depth: null, colors: true}))
// }
