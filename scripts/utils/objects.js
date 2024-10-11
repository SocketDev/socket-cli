'use strict'

const { toSortedObject } = require('./sorts')

function formatObject(object, space = 2) {
  return JSON.stringify(toSortedObject(object), null, space)
}

function hasKeys(obj) {
  for (const key in obj) {
    if (hasOwn(obj, key)) return true
  }
  return false
}

function hasOwn(obj, propKey) {
  if (obj === null || obj === undefined) return false
  return Object.hasOwn(obj, propKey)
}

module.exports = {
  formatObject,
  hasKeys,
  hasOwn
}
