#!/usr/bin/env node
'use strict'

const Module = require('node:module')

const constants = require('../dist/constants.js')
if (typeof Module.enableCompileCache === 'function') {
  // Lazily access constants.socketCachePath.
  Module.enableCompileCache(constants.socketCachePath)
}
const shadowBin = require(constants.distShadowNpmBinPath)
shadowBin(constants.NPM)
