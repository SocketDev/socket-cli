#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')
const shadowBin = require(constants.distShadowNpmBinPath)
shadowBin(constants.NPM)
