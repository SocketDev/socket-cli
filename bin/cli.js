#!/usr/bin/env node
'use strict'

const DIST_TYPE = require('semver').satisfies(process.versions.node, '>=22.12')
  ? 'module-sync'
  : 'require'
require(`../dist/${DIST_TYPE}/cli.js`)
