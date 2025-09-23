import type { SocketArtifact } from '../../utils/alert/artifact.mts'

/**
 * Helper function to create a simple clean scan with no security issues.
 */
export function getSimpleCleanScan(): SocketArtifact[] {
  return [
    {
      id: '12521',
      author: ['typescript-bot'],
      size: 33965,
      type: 'npm',
      name: 'tslib',
      version: '1.14.1',
      license: '0BSD',
      licenseDetails: [],
      score: {
        license: 1,
        maintenance: 0.86,
        overall: 0.86,
        quality: 1,
        supplyChain: 1,
        vulnerability: 1,
      },
      alerts: [],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440,
        },
      ],
      topLevelAncestors: ['15903631404'],
    },
  ]
}

/**
 * Helper function to create a scan with environment variable alerts.
 */
export function getScanWithEnvVars(): SocketArtifact[] {
  return [
    {
      id: '12521',
      author: ['typescript-bot'],
      size: 33965,
      type: 'npm',
      name: 'tslib',
      version: '1.14.1',
      license: '0BSD',
      licenseDetails: [],
      score: {
        license: 1,
        maintenance: 0.86,
        overall: 0.86,
        quality: 1,
        supplyChain: 1,
        vulnerability: 1,
      },
      alerts: [
        {
          type: 'envVars',
          key: 'package/which.js',
          start: 54,
          end: 72,
          props: {
            // @ts-ignore - Test data.
            envVars: 'XYZ',
          },
        },
        {
          type: 'envVars',
          key: 'package/which.js',
          start: 200,
          end: 250,
          props: {
            // @ts-ignore - Test data.
            envVars: 'ABC',
          },
        },
      ],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440,
        },
      ],
      topLevelAncestors: ['15903631404'],
    },
  ]
}

/**
 * Helper function to create a scan with multiple packages and alerts for testing folding.
 */
export function getScanWithMultiplePackages(): SocketArtifact[] {
  return [
    {
      id: '12521',
      author: ['typescript-bot'],
      size: 33965,
      type: 'npm',
      name: 'tslib',
      version: '1.14.1',
      license: '0BSD',
      licenseDetails: [],
      score: {
        license: 1,
        maintenance: 0.86,
        overall: 0.86,
        quality: 1,
        supplyChain: 1,
        vulnerability: 1,
      },
      alerts: [
        {
          type: 'envVars',
          key: 'package/which.js',
          start: 54,
          end: 72,
          props: {
            // @ts-ignore - Test data.
            envVars: 'XYZ',
          },
        },
        {
          type: 'envVars',
          key: 'package/which.js',
          start: 200,
          end: 250,
          props: {
            // @ts-ignore - Test data.
            envVars: 'ABC',
          },
        },
      ],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 600172,
          end: 600440,
        },
      ],
      topLevelAncestors: ['15903631404'],
    },
    {
      id: '12345',
      author: ['lodash-team'],
      size: 1400000,
      type: 'npm',
      name: 'lodash',
      version: '4.17.21',
      license: 'MIT',
      licenseDetails: [],
      score: {
        license: 1,
        maintenance: 0.98,
        overall: 0.95,
        quality: 1,
        supplyChain: 0.95,
        vulnerability: 0.95,
      },
      alerts: [
        {
          type: 'envVars',
          key: 'lodash.js',
          start: 100,
          end: 120,
          props: {
            // @ts-ignore - Test data.
            envVars: 'SECRET_KEY',
          },
        },
      ],
      manifestFiles: [
        {
          file: 'package-lock.json',
          start: 700000,
          end: 700500,
        },
      ],
      topLevelAncestors: ['15903631405'],
    },
  ]
}
