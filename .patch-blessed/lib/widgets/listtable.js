/**
 * listtable.js - list table element for blessed
 * Copyright (c) 2013-2015, Christopher Jeffrey and contributors (MIT License).
 * https://github.com/chjj/blessed
 */

/**
 * Modules
 */

const Node = require('./node')
const Box = require('./box')
const List = require('./list')
const Table = require('./table')

/**
 * ListTable
 */

function ListTable(options) {
  const self = this

  if (!(this instanceof Node)) {
    return new ListTable(options)
  }

  options = options || {}
  options.shrink = true
  options.normalShrink = true
  options.style = options.style || {}
  options.style.border = options.style.border || {}
  options.style.header = options.style.header || {}
  options.style.cell = options.style.cell || {}
  this.__align = options.align || 'center'
  delete options.align

  options.style.selected = options.style.cell.selected
  options.style.item = options.style.cell

  List.call(this, options)

  this._header = new Box({
    parent: this,
    left: this.screen.autoPadding ? 0 : this.ileft,
    top: 0,
    width: 'shrink',
    height: 1,
    style: options.style.header,
    tags: options.parseTags || options.tags,
  })

  this.on('scroll', function () {
    self._header.setFront()
    self._header.rtop = self.childBase
    if (!self.screen.autoPadding) {
      self._header.rtop = self.childBase + (self.border ? 1 : 0)
    }
  })

  this.pad = options.pad != null ? options.pad : 2

  this.setData(options.rows || options.data)

  this.on('attach', function () {
    self.setData(self.rows)
  })

  this.on('resize', function () {
    const selected = self.selected
    self.setData(self.rows)
    self.select(selected)
    self.screen.render()
  })
}

ListTable.prototype.__proto__ = List.prototype

ListTable.prototype.type = 'list-table'

ListTable.prototype._calculateMaxes = Table.prototype._calculateMaxes

ListTable.prototype.setRows = ListTable.prototype.setData = function (rows) {
  const self = this,
    align = this.__align

  if (this.visible && this.lpos) {
    this.clearPos()
  }

  this.clearItems()

  this.rows = rows || []

  this._calculateMaxes()

  if (!this._maxes) {
    return
  }

  this.addItem('')

  this.rows.forEach(function (row, i) {
    const isHeader = i === 0
    let text = ''
    row.forEach(function (cell, i) {
      const width = self._maxes[i]
      let clen = self.strWidth(cell)

      if (i !== 0) {
        text += ' '
      }

      while (clen < width) {
        if (align === 'center') {
          cell = ' ' + cell + ' '
          clen += 2
        } else if (align === 'left') {
          cell = cell + ' '
          clen += 1
        } else if (align === 'right') {
          cell = ' ' + cell
          clen += 1
        }
      }

      if (clen > width) {
        if (align === 'center') {
          cell = cell.substring(1)
          clen--
        } else if (align === 'left') {
          cell = cell.slice(0, -1)
          clen--
        } else if (align === 'right') {
          cell = cell.substring(1)
          clen--
        }
      }

      text += cell
    })
    if (isHeader) {
      self._header.setContent(text)
    } else {
      self.addItem(text)
    }
  })

  this._header.setFront()

  this.select(0)
}

ListTable.prototype._select = ListTable.prototype.select
ListTable.prototype.select = function (i) {
  if (i === 0) {
    i = 1
  }
  if (i <= this.childBase) {
    this.setScroll(this.childBase - 1)
  }
  return this._select(i)
}

ListTable.prototype.render = function () {
  const self = this

  const coords = this._render()
  if (!coords) {
    return
  }

  this._calculateMaxes()

  if (!this._maxes) {
    return coords
  }

  let lines = this.screen.lines,
    xi = coords.xi,
    yi = coords.yi,
    rx,
    ry,
    i

  const battr = this.sattr(this.style.border)

  const height = coords.yl - coords.yi - this.ibottom

  if (!this.border || this.options.noCellBorders) {
    return coords
  }

  // Draw border with correct angles.
  ry = 0
  for (i = 0; i < height + 1; i++) {
    if (!lines[yi + ry]) {
      break
    }
    rx = 0
    self._maxes.slice(0, -1).forEach(function (max) {
      rx += max
      if (!lines[yi + ry][xi + rx + 1]) {
        return
      }
      // center
      if (ry === 0) {
        // top
        rx++
        lines[yi + ry][xi + rx][0] = battr
        lines[yi + ry][xi + rx][1] = '\u252c' // '┬'
        // XXX If we alter iheight and itop for no borders - nothing should be written here
        if (!self.border.top) {
          lines[yi + ry][xi + rx][1] = '\u2502' // '│'
        }
        lines[yi + ry].dirty = true
      } else if (ry === height) {
        // bottom
        rx++
        lines[yi + ry][xi + rx][0] = battr
        lines[yi + ry][xi + rx][1] = '\u2534' // '┴'
        // XXX If we alter iheight and ibottom for no borders - nothing should be written here
        if (!self.border.bottom) {
          lines[yi + ry][xi + rx][1] = '\u2502' // '│'
        }
        lines[yi + ry].dirty = true
      } else {
        // middle
        rx++
      }
    })
    ry += 1
  }

  // Draw internal borders.
  for (ry = 1; ry < height; ry++) {
    if (!lines[yi + ry]) {
      break
    }
    rx = 0
    self._maxes.slice(0, -1).forEach(function (max) {
      rx += max
      if (!lines[yi + ry][xi + rx + 1]) {
        return
      }
      if (self.options.fillCellBorders !== false) {
        const lbg = lines[yi + ry][xi + rx][0] & 0x1ff
        rx++
        lines[yi + ry][xi + rx][0] = (battr & ~0x1ff) | lbg
      } else {
        rx++
        lines[yi + ry][xi + rx][0] = battr
      }
      lines[yi + ry][xi + rx][1] = '\u2502' // '│'
      lines[yi + ry].dirty = true
    })
  }

  return coords
}

/**
 * Expose
 */

module.exports = ListTable
