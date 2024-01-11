import { exec } from 'child_process'
import fs from 'fs'
import homedir from 'os'
import readline from 'readline'

console.log(`
 _____         _       _
|   __|___ ___| |_ ___| |_
|__   | . |  _| '_| -_|  _|
|_____|___|___|_,_|___|_|

`)

/**
 * @param {string} query
 * @returns {void}
 */
const installSafeNpm = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return askQuestion(rl, query)
}

/**
 * @param {any} rl
 * @param {string} query
 * @returns {void}
 */
const askQuestion = (rl, query) => {
  rl.question(query, (/** @type {string} */ ans) => {
    if (ans.toLowerCase() === 'y') {
      const bashFile = `${homedir.homedir()}/.bashrc`
      const zshBashFile = `${homedir.homedir()}/.zshrc`

      try {
        if (fs.existsSync(bashFile)) {
          addAlias(bashFile)
        } else if (fs.existsSync(zshBashFile)) {
          addAlias(zshBashFile)
        }
      } catch (e) {
        throw new Error('There was an issue setting up the alias.', { cause: e })
      }
      rl.close()
    } else if (ans.toLowerCase() !== 'n') {
      askQuestion(rl, 'Incorrect input: please enter either y (yes) or n (no): ')
    } else {
      rl.close()
    }
  })
}

/**
 * @param {string} file
 * @returns {void}
 */
const addAlias = (file) => {
  exec(`echo "alias npm='socket npm' \nalias npx='socket npx'" >> ${file}`, (err, _, stderr) => {
    if (err) {
      return new Error(`There was an error setting up the alias: ${stderr}`)
    }
    console.log(`The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉`)
  })
}

installSafeNpm(`The Socket CLI is now successfully installed! 🎉

To better protect yourself against supply-chain attacks, our "safe npm" wrapper can warn you about malicious packages whenever you run 'npm install'.

Do you want to install "safe npm" (this will create an alias to the socket-npm command)? (y/n)`)
