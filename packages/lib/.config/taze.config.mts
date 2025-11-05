import { defineConfig } from 'taze'

export default defineConfig({
  // Exclude these packages.
  exclude: [
    'debug',
    'eslint-plugin-unicorn',
    'make-fetch-happen',
    'minimatch',
    'normalize-package-data',
  ],
  // Interactive mode disabled for automation.
  interactive: false,
  // Silent logging.
  loglevel: 'silent',
  // Only update packages that have been stable for 7 days.
  maturityPeriod: 7,
  // Update mode: 'latest'.
  mode: 'latest',
  // Recursive mode to handle all package.json files.
  recursive: true,
  // Write to package.json automatically.
  write: true,
})
