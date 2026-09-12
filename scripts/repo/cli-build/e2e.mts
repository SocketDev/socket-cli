import { runProductTests } from './product-tests.mts'

runProductTests('e2e').catch(error => {
  process.exitCode = 1
  throw error
})
