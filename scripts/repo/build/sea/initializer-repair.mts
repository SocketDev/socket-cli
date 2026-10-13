import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { relocateDarwinInitializerOffsets } from './initializer-offsets.mts'

async function runCodesign(
  args: string[],
  action: string,
  outputPath: string,
): Promise<void> {
  const result = await spawn('codesign', args, {
    stdio: 'pipe',
    timeout: 30_000,
  })
  if (result.code !== 0) {
    throw new Error(
      `Could not ${action}. Where: ${outputPath}. Saw: codesign exit ${result.code ?? 'without a status'}; wanted: exit 0. Fix: check the binary and codesign environment, then retry.`,
    )
  }
}

export async function repairDarwinInitializerOffsets(
  runtime: Buffer,
  outputPath: string,
  options: { platform?: NodeJS.Platform | undefined } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') {
    await runCodesign(
      ['--remove-signature', outputPath],
      'remove the injected signature',
      outputPath,
    )
  }
  const injected = await readFile(outputPath)
  const relocated = relocateDarwinInitializerOffsets(runtime, injected)
  if (relocated !== injected) {
    await writeFile(outputPath, relocated)
  }
  if (platform === 'darwin') {
    await runCodesign(
      ['--force', '--sign', '-', outputPath],
      'restore the ad hoc signature',
      outputPath,
    )
    await runCodesign(
      ['--verify', '--strict', outputPath],
      'verify the ad hoc signature',
      outputPath,
    )
  }
}
