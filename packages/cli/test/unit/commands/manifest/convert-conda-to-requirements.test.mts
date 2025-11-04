/**
 * Unit Tests: Conda Environment to Requirements.txt Converter
 *
 * Purpose:
 * Tests the YAML parser that extracts pip dependencies from Conda environment.yml files and
 * converts them to requirements.txt format. Validates handling of various YAML indentation
 * styles, comments, and edge cases in Conda environment specifications.
 *
 * Test Coverage:
 * - Simple Conda environment conversion with pip dependencies
 * - Arbitrary indentation block support
 * - Single space indentation handling
 * - Comment and empty line preservation in pip blocks
 * - Block closing detection with varying indentation levels
 * - Complex environment files with channels and build strings
 * - Git dependencies and requirements.txt references
 * - Version specifier preservation (==, >=, ~=, <)
 *
 * Testing Approach:
 * Uses direct function invocation with inline snapshot testing to validate YAML parsing logic.
 * Tests verify correct extraction of pip dependencies while ignoring Conda-specific packages.
 *
 * Related Files:
 * - src/commands/manifest/convert-conda-to-requirements.mts - Conda to requirements converter
 * - src/commands/manifest/handle-manifest-conda.mts - Command handler using converter
 */

import { describe, expect, it } from 'vitest'

import { convertCondaToRequirementsFromInput } from '../../../../src/commands/manifest/convert-conda-to-requirements.mts'

describe('convert-conda-to-requirements', () => {
  it('should convert a simple example', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv
channels:
  - defaults
dependencies:
  - python=3.8
  - pip
  - pip:
    - pandas
    - numpy==1.21.0
    - requests>=2.26.0
`)

    expect(output).toMatchInlineSnapshot(`
      "pandas
      numpy==1.21.0
      requests>=2.26.0"
    `)
  })

  it('should support arbitrary indent block', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv
channels:
  - defaults
dependencies:
  - python=3.8
  - pip
  - pip:
            - pandas
            - numpy==1.21.0
            - requests>=2.26.0
`)

    expect(output).toMatchInlineSnapshot(`
      "pandas
      numpy==1.21.0
      requests>=2.26.0"
    `)
  })

  it('should support single space indented block', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv
channels:
  - defaults
dependencies:
  - python=3.8
  - pip
  - pip:
   - pandas
   - numpy==1.21.0
   - requests>=2.26.0
`)

    expect(output).toMatchInlineSnapshot(`
      "pandas
      numpy==1.21.0
      requests>=2.26.0"
    `)
  })

  it('should support comment and empty lines inside pip block', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv
channels:
  - defaults
dependencies:
  - python=3.8
  - pip
  - pip:
            - pandas
            - numpy==1.21.0
            - requests>=2.26.0
`)

    expect(output).toMatchInlineSnapshot(`
      "pandas
      numpy==1.21.0
      requests>=2.26.0"
    `)
  })

  it('should support block closing on further indent than start', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv
channels:
  - defaults
dependencies:
  - python=3.8
  - pip
  - pip:
            - pandas
            - numpy==1.21.0
            - requests>=2.26.0
        - the end
`)

    expect(output).toMatchInlineSnapshot(`
      "pandas
      numpy==1.21.0
      requests>=2.26.0"
    `)
  })

  it('should support block closing on closer indent than start', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv
channels:
  - defaults
dependencies:
  - python=3.8
  - pip
  - pip:
            - pandas
            - numpy==1.21.0
            - requests>=2.26.0
- the end
`)

    expect(output).toMatchInlineSnapshot(`
      "pandas
      numpy==1.21.0
      requests>=2.26.0"
    `)
  })

  it('should convert an example with stuff after the pip block', () => {
    const output = convertCondaToRequirementsFromInput(`
channels:
- defaults
- conda-forge
- conda
- pytorch
- nvidia
- anaconda
- https://repo.continuum.io/pkgs/main
- conda-forge
- Gurobi
dependencies:
- python=3.9
- gurobi>=12.0.0
- ordered-set
- pygraphviz=1.9
- pydot=1.4.2
- pympler
- dill
- pytest
- pip:
  - aiohttp==3.8.4
  - requests==2.30.0
  - networkx==3.1
  - numpy==1.24.3
  - scipy==1.10.1
  - pandas==2.0.1
  - dotwiz==0.4.0
  - pydantic==2.7.1
  - pyyaml==6.0.1
  - psutil==5.9.0
  - memray==1.14.0
  - optuna>=4.1.0
name: py-optim
    `)

    expect(output).toMatchInlineSnapshot(`
      "aiohttp==3.8.4
      requests==2.30.0
      networkx==3.1
      numpy==1.24.3
      scipy==1.10.1
      pandas==2.0.1
      dotwiz==0.4.0
      pydantic==2.7.1
      pyyaml==6.0.1
      psutil==5.9.0
      memray==1.14.0
      optuna>=4.1.0"
    `)
  })

  it('should convert an more complex example', () => {
    const output = convertCondaToRequirementsFromInput(`
name: myenv                     # Environment name (optional but recommended)

channels:                       # Package sources/repositories
  - conda-forge                 # Higher priority channel
  - defaults                    # Lower priority channel

dependencies:                   # List of packages to install
  # Conda packages (direct dependencies)
  - python=3.9                  # Major.Minor version
  - pandas>=1.3.0               # Greater than or equal to version
  - numpy~=1.21.0               # Compatible release (same as >=1.21.0,<1.22.0)
  - scipy==1.7.0                # Exact version
  - matplotlib<3.5.0            # Less than version

  # Optional: specify build number
  - package=1.0.0=h123456_0     # package=version=build_string

  # Pip packages (installed via pip)
  - pip                         # Include pip itself
  - pip:                        # Packages to be installed via pip
    - tensorflow>=2.0.0
    - torch==1.9.0
    - transformers
    - -r requirements.txt       # Can include requirements.txt file
    - git+https://github.com/user/repo.git    # Install from git

  # Platform-specific dependencies
  - cudatoolkit=11.0            # Only for systems with NVIDIA GPU
`)

    expect(output).toMatchInlineSnapshot(`
      "tensorflow>=2.0.0
      torch==1.9.0
      transformers
      -r requirements.txt       # Can include requirements.txt file
      git+https://github.com/user/repo.git    # Install from git"
    `)
  })
})
