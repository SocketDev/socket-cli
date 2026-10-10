export function validateToolExecutable(directory: string, executable: string): void

export function installToolAtomically(options: {
  destination: string
  executable: string
  install: (directory: string) => Promise<number>
}): Promise<number>
