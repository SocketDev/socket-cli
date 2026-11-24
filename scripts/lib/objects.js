'use strict'

function hasKeys(value) {
  return value != null && Object.keys(value).length > 0
}

module.exports = { hasKeys }
