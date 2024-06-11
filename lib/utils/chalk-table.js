// // Inspired by https://www.npmjs.com/package/chalk-table
// import chalk from 'chalk'
// import stripAnsi from 'strip-ansi'

// export default (/** @type {{columns: []}} */ options, data) => {
//   const pad = (text, length) => {
//     if (typeof text === 'undefined') {
//       text = ''
//     }

//     return (
//       '' +
//       text +
//       new Array(Math.max(length - stripAnsi('' + text).length + 1, 0)).join(' ')
//     )
//   }

//   if (typeof options === 'object' && Array.isArray(options)) {
//     const tmp = data
//     data = options
//     options = tmp
//   }

//   if (!options) {
//     options = {}
//   }

//   if (!options.intersectionCharacter) {
//     options.intersectionCharacter = '+'
//   }

//   let columns
//   if (options.columns) {
//     columns = options.columns
//   } else {
//     columns = []
//     data.forEach(e =>
//       Object.keys(e)
//         .filter(k => columns.indexOf(k) === -1)
//         .forEach(k => {
//           columns.push(k)
//         })
//     )
//   }

//   columns = columns.map(e => {
//     if (typeof e === 'string') {
//       e = {
//         name: e,
//         field: e
//       }
//     }

//     e.name = chalk.bold(e.name)
//     e.width = stripAnsi(e.name).length

//     return e
//   })

//   data.forEach(e =>
//     columns.forEach(column => {
//       if (typeof e[column.field] === 'undefined') {
//         return
//       }

//       column.width = Math.max(
//         column.width,
//         ('' + stripAnsi(e[column.field])).length
//       )
//     })
//   )

//   const output = []

//   const separator = ['']
//     .concat(columns.map(e => new Array(e.width + 1).join('-')))
//     .concat([''])
//     .join('-' + options.intersectionCharacter + '-')

//   output.push(separator)
//   output.push(
//     ['']
//       .concat(columns.map(e => pad(e.name, e.width)))
//       .concat([''])
//       .join(' | ')
//   )
//   output.push(separator)
//   data.forEach(row => {
//     output.push(
//       ['']
//         .concat(columns.map(column => pad(row[column.field], column.width)))
//         .concat([''])
//         .join(' | ')
//     )
//   })
//   output.push(separator)

//   return (
//     output.map(e => e.replace(/^[ -]/, '').replace(/[ -]$/, '')).join('\n')
//   )
// }
