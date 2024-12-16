#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')
const shadowBin = require(`../dist/${constants.DIST_TYPE}/shadow-bin.js`)
shadowBin('npm')
