'use strict'

const { readFileSync } = require('node:fs')

function loadJSON(filepath) {
  return JSON.parse(readFileSync(filepath, 'utf8'))
}

module.exports = {
  loadJSON
}
