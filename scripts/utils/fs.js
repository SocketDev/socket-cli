'use strict'

const { readFileSync } = require('node:fs')
const path = require('node:path')

const { normalizePackageJson } = require('./packages')

const PACKAGE_JSON = 'package.json'

function readJsonSync(filepath) {
  return JSON.parse(readFileSync(filepath, 'utf8'))
}

function readPackageJsonSync(filepath_) {
  const filepath = filepath_.endsWith(PACKAGE_JSON)
    ? filepath_
    : path.join(filepath_, PACKAGE_JSON)
  return normalizePackageJson(JSON.parse(readFileSync(filepath, 'utf8')))
}

module.exports = {
  readJsonSync,
  readPackageJsonSync
}
