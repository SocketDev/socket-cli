import { describe, expect, it } from 'vitest'

import { createAlertUXLookup } from './dist/alert-rules'

describe('Alert Rule UX', () => {
  it('should properly defer', () => {
    const noEntriesLookup = createAlertUXLookup({
      defaults: {
        issueRules: {
          fromDeferString: {
            action: 'warn'
          },
          fromUndefinedAction: {
            action: 'warn'
          },
          fromUndefinedRule: {
            action: 'warn'
          },
          willError: {
            action: 'error'
          },
          willIgnore: {
            action: 'ignore'
          },
          willWarn: {
            action: 'warn'
          }
        }
      },
      entries: [
        {
          start: 'organization',
          settings: {
            organization: {
              deferTo: 'repository',
              issueRules: {
                fromDeferString: { action: 'defer' },
                // @ts-ignore paranoia
                fromUndefinedAction: {}
              }
            },
            repository: {
              deferTo: null,
              issueRules: {
                fromMiddleConfig: {
                  action: 'warn'
                }
              }
            }
          }
        }
      ]
    })
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willError' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willIgnore' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": false,
      }
    `)
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willWarn' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": true,
      }
    `)
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromDeferString' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": true,
      }
    `)
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromUndefinedAction' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": true,
      }
    `)
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromUndefinedRule' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": true,
      }
    `)
    expect(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromMiddleConfig' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": true,
      }
    `)
  })
  it('should use error UX when missing keys', () => {
    const emptyLookup = createAlertUXLookup({
      defaults: {
        issueRules: {}
      },
      entries: []
    })
    expect(
      emptyLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: '404' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
  })
  it('should use error/ignore UX when having boolean values instead of config', () => {
    const booleanLookup = createAlertUXLookup({
      defaults: {
        issueRules: {
          // @ts-ignore backcompat
          defaultTrue: true,
          // @ts-ignore backcompat
          defaultFalse: false
        }
      },
      entries: [
        {
          start: 'organization',
          settings: {
            organization: {
              issueRules: {
                // @ts-ignore backcompat
                orgTrue: true,
                // @ts-ignore backcompat
                orgFalse: false
              }
            }
          }
        }
      ]
    })
    expect(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'defaultTrue' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
    expect(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'orgTrue' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
    expect(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'defaultFalse' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": false,
      }
    `)
    expect(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'orgFalse' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": false,
      }
    `)
  })
  it('should use the maximal strength on multiple settings entries', () => {
    const multiSettings = createAlertUXLookup({
      defaults: {
        issueRules: {}
      },
      entries: [
        {
          start: 'start',
          settings: {
            start: {
              deferTo: null,
              issueRules: {
                warn_then_error: {
                  action: 'warn'
                },
                ignore_then_missing: {
                  action: 'ignore'
                },
                ignore_then_defer: {
                  action: 'ignore'
                }
              }
            }
          }
        },
        {
          start: 'start',
          settings: {
            start: {
              deferTo: null,
              issueRules: {
                warn_then_error: {
                  action: 'error'
                },
                ignore_then_defer: {
                  action: 'defer'
                }
              }
            }
          }
        }
      ]
    })
    expect(
      multiSettings({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'warn_then_error' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
    expect(
      multiSettings({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'ignore_then_missing' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
    expect(
      multiSettings({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'ignore_then_defer' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": true,
        "display": true,
      }
    `)
  })
  it('should shadow defaults', () => {
    const shadowedLookup = createAlertUXLookup({
      defaults: {
        issueRules: {
          willWarn: {
            action: 'warn'
          }
        }
      },
      entries: [
        {
          start: 'organization',
          settings: {
            organization: {
              deferTo: null,
              issueRules: {
                willWarn: {
                  action: 'ignore'
                }
              }
            }
          }
        }
      ]
    })
    expect(
      shadowedLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willWarn' }
      })
    ).toMatchInlineSnapshot(`
      {
        "block": false,
        "display": false,
      }
    `)
  })
})
