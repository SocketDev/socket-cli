'use strict'

const ansiRegExp =
  // eslint-disable-next-line no-control-regex -- The expression removes ANSI control codes.
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C)|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g

function stripAnsi(value) {
  return String(value).replace(ansiRegExp, '')
}

module.exports = { stripAnsi }
