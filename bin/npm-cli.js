#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants.js')
const shadowBin = require(constants.distShadowNpmBinPath)
shadowBin(constants.NPM)
