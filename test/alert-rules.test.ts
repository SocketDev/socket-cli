import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

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
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willError' }
      }),
      {
        block: true,
        display: true
      }
    )
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willIgnore' }
      }),
      {
        block: false,
        display: false
      }
    )
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willWarn' }
      }),
      {
        block: false,
        display: true
      }
    )
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromDeferString' }
      }),
      {
        block: false,
        display: true
      }
    )
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromUndefinedAction' }
      }),
      {
        block: false,
        display: true
      }
    )
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromUndefinedRule' }
      }),
      {
        block: false,
        display: true
      }
    )
    assert.deepEqual(
      noEntriesLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'fromMiddleConfig' }
      }),
      {
        block: false,
        display: true
      }
    )
  })
  it('should use error UX when missing keys', () => {
    const emptyLookup = createAlertUXLookup({
      defaults: {
        issueRules: {}
      },
      entries: []
    })
    assert.deepEqual(
      emptyLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: '404' }
      }),
      {
        block: true,
        display: true
      }
    )
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
    assert.deepEqual(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'defaultTrue' }
      }),
      {
        block: true,
        display: true
      }
    )
    assert.deepEqual(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'orgTrue' }
      }),
      {
        block: true,
        display: true
      }
    )
    assert.deepEqual(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'defaultFalse' }
      }),
      {
        block: false,
        display: false
      }
    )
    assert.deepEqual(
      booleanLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'orgFalse' }
      }),
      {
        block: false,
        display: false
      }
    )
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
    assert.deepEqual(
      multiSettings({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'warn_then_error' }
      }),
      {
        block: true,
        display: true
      }
    )
    assert.deepEqual(
      multiSettings({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'ignore_then_missing' }
      }),
      {
        block: true,
        display: true
      }
    )
    assert.deepEqual(
      multiSettings({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'ignore_then_defer' }
      }),
      {
        block: true,
        display: true
      }
    )
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
    assert.deepEqual(
      shadowedLookup({
        package: {
          name: 'bar',
          version: '0.0.0'
        },
        alert: { type: 'willWarn' }
      }),
      {
        block: false,
        display: false
      }
    )
  })
})
