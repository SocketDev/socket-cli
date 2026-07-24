/*!
 * on-headers
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module exports.
 *
 * @public
 */

module.exports = onHeaders

const http = require('node:http')

// older node versions don't have appendHeader
const isAppendHeaderSupported =
  typeof http.ServerResponse.prototype.appendHeader === 'function'
const set1dArray = isAppendHeaderSupported
  ? set1dArrayWithAppend
  : set1dArrayWithSet

/**
 * Create a replacement writeHead method.
 *
 * @private
 *
 * @param {function} prevWriteHead
 * @param {function} listener
 */

function createWriteHead(prevWriteHead, listener) {
  let fired = false

  // return function with core name and argument list
  return function writeHead(statusCode) {
    // set headers from arguments
    const args = setWriteHeadHeaders.apply(this, arguments)

    // fire listener
    if (!fired) {
      fired = true
      listener.call(this)

      // pass-along an updated status code
      if (typeof args[0] === 'number' && this.statusCode !== args[0]) {
        args[0] = this.statusCode
        args.length = 1
      }
    }

    return prevWriteHead.apply(this, args)
  }
}

/**
 * Execute a listener when a response is about to write headers.
 *
 * @param {object} res
 *
 * @returns {function} Listener
 *
 * @public
 */

function onHeaders(res, listener) {
  if (!res) {
    throw new TypeError('argument res is required')
  }

  if (typeof listener !== 'function') {
    throw new TypeError('argument listener must be a function')
  }

  res.writeHead = createWriteHead(res.writeHead, listener)
}

/**
 * Set headers contained in array on the response object.
 *
 * @private
 *
 * @param {object} res
 * @param {array} headers
 */

function setHeadersFromArray(res, headers) {
  if (headers.length && Array.isArray(headers[0])) {
    // 2D
    set2dArray(res, headers)
  } else {
    // 1D
    if (headers.length % 2 !== 0) {
      throw new TypeError('headers array is malformed')
    }

    set1dArray(res, headers)
  }
}

/**
 * Set headers contained in object on the response object.
 *
 * @private
 *
 * @param {object} res
 * @param {object} headers
 */

function setHeadersFromObject(res, headers) {
  const keys = Object.keys(headers)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k) {res.setHeader(k, headers[k])}
  }
}

/**
 * Set headers and other properties on the response object.
 *
 * @private
 *
 * @param {number} statusCode
 */

function setWriteHeadHeaders(statusCode) {
  const length = arguments.length
  const headerIndex = length > 1 && typeof arguments[1] === 'string' ? 2 : 1

  const headers = length >= headerIndex + 1 ? arguments[headerIndex] : undefined

  this.statusCode = statusCode

  if (Array.isArray(headers)) {
    // handle array case
    setHeadersFromArray(this, headers)
  } else if (headers) {
    // handle object case
    setHeadersFromObject(this, headers)
  }

  // copy leading arguments
  const args = new Array(Math.min(length, headerIndex))
  for (let i = 0; i < args.length; i++) {
    args[i] = arguments[i]
  }

  return args
}

function set2dArray(res, headers) {
  let key
  for (let i = 0; i < headers.length; i++) {
    key = headers[i][0]
    if (key) {
      res.setHeader(key, headers[i][1])
    }
  }
}

function set1dArrayWithAppend(res, headers) {
  for (let i = 0; i < headers.length; i += 2) {
    res.removeHeader(headers[i])
  }

  let key
  for (let j = 0; j < headers.length; j += 2) {
    key = headers[j]
    if (key) {
      res.appendHeader(key, headers[j + 1])
    }
  }
}

function set1dArrayWithSet(res, headers) {
  let key
  for (let i = 0; i < headers.length; i += 2) {
    key = headers[i]
    if (key) {
      res.setHeader(key, headers[i + 1])
    }
  }
}
