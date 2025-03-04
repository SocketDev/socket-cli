#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')
const shadowBin = require(
  `${constants.distPath}/${constants.SHADOW_NPM_BIN}.js`
)
shadowBin(constants.NPX)
