/**
 * @fileoverview Git utilities for socket-cli.
 * Simple implementations of git functions using child_process.
 * All functions are synchronous since they use execSync.
 */

import { execSync } from 'node:child_process'

/**
 * Execute a git command and return the output as an array of lines.
 * @private
 */
function execGitCommand(command) {
  try {
    const output = execSync(`git ${command}`, { encoding: 'utf8', stdio: 'pipe' })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Get all changed files (staged and unstaged) compared to HEAD.
 * @returns {string[]} Array of file paths
 */
export function getChangedFiles() {
  return execGitCommand('diff --name-only HEAD')
}

/**
 * Get only staged files.
 * @returns {string[]} Array of file paths
 */
export function getStagedFiles() {
  return execGitCommand('diff --cached --name-only')
}

/**
 * Get only unstaged files.
 * @returns {string[]} Array of file paths
 */
export function getUnstagedFiles() {
  return execGitCommand('diff --name-only')
}