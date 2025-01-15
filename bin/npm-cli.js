#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')
const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
shadowBin(constants.NPM)
