import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

export function validateToolExecutable(directory, executable) {
  const binary = path.resolve(directory, executable)
  const relative = path.relative(path.resolve(directory), binary)
  if (
    path.isAbsolute(executable) ||
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Tool executable path is invalid at ${directory}: saw ${executable}; wanted a relative file inside the installation. Set --atomic to the extracted executable path.`,
    )
  }
  try {
    accessSync(binary, constants.X_OK)
    if (!statSync(binary).isFile()) {
      throw new Error('Not a file')
    }
  } catch (cause) {
    throw new Error(
      `Tool installation is incomplete at ${directory}: wanted executable ${executable}. Remove the incomplete installation when no job uses it, then retry setup.`,
      { cause },
    )
  }
}

export async function installToolAtomically({
  destination,
  executable,
  install,
}) {
  const parent = path.dirname(destination)
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(
    path.join(parent, `.${path.basename(destination)}-install-`),
  )
  try {
    const exitCode = await install(staging)
    if (exitCode !== 0) {
      return exitCode
    }
    validateToolExecutable(staging, executable)
    try {
      renameSync(staging, destination)
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') {
        throw error
      }
      validateToolExecutable(destination, executable)
    }
    return 0
  } finally {
    // oxlint-disable-next-line socket/prefer-safe-delete -- dep-0 staging
    rmSync(staging, { recursive: true, force: true })
  }
}
