import { runProductTests } from './product-tests.mts'

runProductTests('integration').catch(error => {
  process.exitCode = 1
  throw error
})
