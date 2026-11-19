'use strict'

const { readdirSync } = require('node:fs')

function isDirEmptySync(directory) {
  try {
    const ignored = new Set([
      '.git',
      '.npmrc',
      'node_modules',
      '.DS_Store',
      '.gitignore',
      '.hg',
      '.lock-wscript',
      '.npmignore',
      '.svn',
      '.env',
      '.eslintcache',
      '.nvm',
      '.tap',
      '.vscode',
      'Thumbs.db',
      'bower_components',
    ])
    return readdirSync(directory).every(
      name =>
        ignored.has(name) ||
        name.startsWith('.wafpickle-') ||
        name.startsWith('._') ||
        /^\..*\.swp$/.test(name) ||
        /^.*\.orig$/.test(name) ||
        /^.*\.tsbuildinfo$/.test(name),
    )
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

module.exports = { isDirEmptySync }
