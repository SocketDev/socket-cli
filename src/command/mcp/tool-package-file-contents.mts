import { Type } from '@sinclair/typebox'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { getOrFetchSocketBlob } from './lib/blob-cache.mts'
import { readToolString } from './tool-args.mts'
import { errorToolResult, textToolResult } from './tool-auth.mts'
import {
  describeToolArgument,
  isSocketBlobHash,
  truncateToolLabel,
} from './tool-input.mts'

import type { ToolSpec } from './tool-types.mts'

export const PACKAGE_FILE_CONTENTS_TOOL_NAME = 'package_file_contents'

export const PACKAGE_FILE_CONTENTS_TOOL_DESCRIPTION =
  'Read a single file from a package using the `package_file_contents` tool from Socket. Pass the `hash` printed next to each entry in `package_files` output. Returns up to 1 MB of UTF-8 text; binary files return metadata only.'

export const PackageFileContentsInputSchema = Type.Object({
  hash: Type.String({
    description:
      'Blob hash exactly as shown by `package_files` (the token printed after each file size)',
  }),
  path: Type.Optional(
    Type.String({
      description:
        'Optional file path for display only; does not affect the lookup',
    }),
  ),
})

export function definePackageFileContentsTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: PACKAGE_FILE_CONTENTS_TOOL_DESCRIPTION,
    handler: async args => {
      const hash = readToolString(args, 'hash')
      const invalid = invalidBlobHashResult('Reading a package file', hash)
      if (invalid || !hash) {
        return errorToolResult(invalid ?? 'Reading a package file failed.')
      }
      const label = truncateToolLabel(readToolString(args, 'path') ?? hash)
      try {
        const blob = await getOrFetchSocketBlob(hash)
        if (blob.binary) {
          return textToolResult(
            `${label} is binary (${blob.bytes} bytes, content-type: ${blob.contentType ?? 'unknown'}). Refusing to return binary contents.`,
          )
        }
        const truncationNote = blob.truncated
          ? `\n\n[truncated — the file is ${blob.bytes} bytes; showing the first 1 MB]`
          : ''
        return textToolResult(
          `${label} (${blob.bytes} bytes)\n\n${blob.text}${truncationNote}`,
        )
      } catch (e) {
        return errorToolResult(errorMessage(e))
      }
    },
    inputSchema: PackageFileContentsInputSchema,
    name: PACKAGE_FILE_CONTENTS_TOOL_NAME,
    title: 'Package File Contents Tool',
  }
}

/**
 * Reject a hash that is not a Socket content-addressed blob token. Shared by
 * the two blob-reading tools so both refuse the same inputs.
 */
export function invalidBlobHashResult(
  what: string,
  hash: string | undefined,
): string | undefined {
  if (hash && isSocketBlobHash(hash)) {
    return undefined
  }
  return `${what} failed. Where: the \`hash\` argument. Saw: ${describeToolArgument(hash)}, wanted a Socket blob hash beginning with Q or S as printed by \`package_files\`. Fix: call \`package_files\` and copy one of the hashes it lists.`
}
