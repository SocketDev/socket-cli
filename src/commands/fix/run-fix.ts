import { npmFix } from './run-npm-fix'
import constants from '../../constants'
import { detectPackageEnvironment } from '../../utils/package-environment-detector'

const { NPM } = constants

export async function runFix() {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start()

  const cwd = process.cwd()
  const details = await detectPackageEnvironment({ cwd })
  if (details.agent === NPM) {
    await npmFix(cwd)
  }
  spinner.stop()
}
