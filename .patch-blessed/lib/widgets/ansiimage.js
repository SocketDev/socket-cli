/**
 * ansiimage.js - render PNGS/GIFS as ANSI
 * Copyright (c) 2013-2015, Christopher Jeffrey and contributors (MIT License).
 * https://github.com/chjj/blessed
 */

/**
 * Modules
 */

const cp = require('child_process')

const colors = require('../colors')

const Node = require('./node')
const Box = require('./box')

const tng = require('../../vendor/tng')

/**
 * ANSIImage
 */

function ANSIImage(options) {
  const self = this

  if (!(this instanceof Node)) {
    return new ANSIImage(options)
  }

  options = options || {}
  options.shrink = true

  Box.call(this, options)

  this.scale = this.options.scale || 1.0
  this.options.animate = this.options.animate !== false
  this._noFill = true

  if (this.options.file) {
    this.setImage(this.options.file)
  }

  this.screen.on('prerender', function () {
    const lpos = self.lpos
    if (!lpos) {
      return
    }
    // prevent image from blending with itself if there are alpha channels
    self.screen.clearRegion(lpos.xi, lpos.xl, lpos.yi, lpos.yl)
  })

  this.on('destroy', function () {
    self.stop()
  })
}

ANSIImage.prototype.__proto__ = Box.prototype

ANSIImage.prototype.type = 'ansiimage'

ANSIImage.curl = function (url) {
  try {
    return cp.execFileSync('curl', ['-s', '-A', '', url], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (e) {}
  try {
    return cp.execFileSync('wget', ['-U', '', '-O', '-', url], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (e) {}
  throw new Error('curl or wget failed.')
}

ANSIImage.prototype.setImage = function (file) {
  this.file = typeof file === 'string' ? file : null

  if (/^https?:/.test(file)) {
    file = ANSIImage.curl(file)
  }

  let width = this.position.width
  let height = this.position.height

  if (width != null) {
    width = this.width
  }

  if (height != null) {
    height = this.height
  }

  try {
    this.setContent('')

    this.img = tng(file, {
      colors: colors,
      width: width,
      height: height,
      scale: this.scale,
      ascii: this.options.ascii,
      speed: this.options.speed,
      filename: this.file,
    })

    if (width == null || height == null) {
      this.width = this.img.cellmap[0].length
      this.height = this.img.cellmap.length
    }

    if (this.img.frames && this.options.animate) {
      this.play()
    } else {
      this.cellmap = this.img.cellmap
    }
  } catch (e) {
    this.setContent('Image Error: ' + e.message)
    this.img = null
    this.cellmap = null
  }
}

ANSIImage.prototype.play = function () {
  const self = this
  if (!this.img) {
    return
  }
  return this.img.play(function (bmp, cellmap) {
    self.cellmap = cellmap
    self.screen.render()
  })
}

ANSIImage.prototype.pause = function () {
  if (!this.img) {
    return
  }
  return this.img.pause()
}

ANSIImage.prototype.stop = function () {
  if (!this.img) {
    return
  }
  return this.img.stop()
}

ANSIImage.prototype.clearImage = function () {
  this.stop()
  this.setContent('')
  this.img = null
  this.cellmap = null
}

ANSIImage.prototype.render = function () {
  const coords = this._render()
  if (!coords) {
    return
  }

  if (this.img && this.cellmap) {
    this.img.renderElement(this.cellmap, this)
  }

  return coords
}

/**
 * Expose
 */

module.exports = ANSIImage
