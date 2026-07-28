/**
 * button.js - button element for blessed
 * Copyright (c) 2013-2015, Christopher Jeffrey and contributors (MIT License).
 * https://github.com/chjj/blessed
 */

/**
 * Modules
 */

const Node = require('./node')
const Input = require('./input')

/**
 * Button
 */

function Button(options) {
  const self = this

  if (!(this instanceof Node)) {
    return new Button(options)
  }

  options = options || {}

  if (options.autoFocus == null) {
    options.autoFocus = false
  }

  Input.call(this, options)

  this.on('keypress', function (ch, key) {
    if (key.name === 'enter' || key.name === 'space') {
      return self.press()
    }
  })

  if (this.options.mouse) {
    this.on('click', function () {
      return self.press()
    })
  }
}

Button.prototype.__proto__ = Input.prototype

Button.prototype.type = 'button'

Button.prototype.press = function () {
  this.focus()
  this.value = true
  const result = this.emit('press')
  delete this.value
  return result
}

/**
 * Expose
 */

module.exports = Button
