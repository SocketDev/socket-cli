#!/usr/bin/env node
'use strict'

const constants = require('../dist/constants')
require(`../dist/${constants.DIST_TYPE}/cli.js`)
