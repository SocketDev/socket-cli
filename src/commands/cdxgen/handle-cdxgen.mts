import { cmdManifestCdxgen } from '../manifest/cmd-manifest-cdxgen.mts'

export async function handleCdxgen(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  await cmdManifestCdxgen.run(argv, importMeta, { parentName })
}
