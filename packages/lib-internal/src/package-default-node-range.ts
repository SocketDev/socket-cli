/**
 * @fileoverview Default Node.js version range for packages.
 */

const maintainedNodeVersions = require('#lib/maintained-node-versions').default
const semver = require('semver')

export default `>=${semver.parse(maintainedNodeVersions.last).major}`
