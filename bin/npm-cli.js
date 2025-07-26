#!/usr/bin/env node
'use strict'

const Module = require('node:module')
const path = require('node:path')
const rootPath = path.join(__dirname, '..')
Module.enableCompileCache?.(path.join(rootPath, '.cache'))

const shadowBin = require(path.join(rootPath, 'dist/shadow-npm-bin.js'))
shadowBin('npm')
