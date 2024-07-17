'use strict'

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
  hasKeys,
  hasOwn
}
