import { defineConfig } from 'taze'

export default defineConfig({
  // Exclude these packages (add as needed).
  exclude: ['eslint-plugin-unicorn', 'openapi-typescript'],
  // Interactive mode disabled for automation.
  interactive: false,
  // Use minimal logging similar to ncu loglevel.
  loglevel: 'warn',
  // Only update packages that have been stable for 7 days.
  maturityPeriod: 7,
  // Update mode: 'latest' is similar to ncu's default behavior.
  mode: 'latest',
  // Write to package.json automatically.
  write: true,
})
