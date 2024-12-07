#!/usr/bin/env node
'use strict'

const semver = require('semver')
const distType = semver.satisfies(process.versions.node, '>=22.12')
  ? 'module-sync'
  : 'require'
require(`../dist/${distType}/cli.js`)
