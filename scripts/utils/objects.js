'use strict'

const { toSortedObject } = require('@socketsecurity/registry/lib/objects')

function formatObject(object, space = 2) {
  return JSON.stringify(toSortedObject(object), null, space)
}

module.exports = {
  formatObject
}
