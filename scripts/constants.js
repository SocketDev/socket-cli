'use strict'

const semver = require('semver')

const registryConstants = require('@socketsecurity/registry/lib/constants')
const {
  objectEntries,
  objectFromEntries
} = require('@socketsecurity/registry/lib/objects')

const ROLLUP_ENTRY_SUFFIX = '?commonjs-entry'
const ROLLUP_EXTERNAL_SUFFIX = '?commonjs-external'
const SLASH_NODE_MODULES_SLASH = '/node_modules/'
const SUPPORTS_SYNC_ESM = semver.satisfies(process.versions.node, '>=22.12')

const constants = Object.freeze(
  Object.defineProperties(
    { __proto__: null },
    objectFromEntries(
      objectEntries(Object.getOwnPropertyDescriptors(registryConstants)).reduce(
        (entries, entry) => {
          if (entries.findIndex(p => p[0] === entry[0]) === -1) {
            entries.push(entry)
          }
          return entries
        },
        objectEntries(
          Object.getOwnPropertyDescriptors({
            ROLLUP_ENTRY_SUFFIX,
            ROLLUP_EXTERNAL_SUFFIX,
            SLASH_NODE_MODULES_SLASH,
            SUPPORTS_SYNC_ESM
          })
        )
      )
    )
  )
)
module.exports = constants
