#!/bin/bash

# Fix shadow test imports to include correct subdirectories

# npm shadow tests
sed -i '' "s|from '../../../../src/bin\.mts'|from '../../../../src/shadow/npm/bin.mts'|g" test/unit/shadow/npm/bin.test.mts
sed -i '' "s|from '../../../../src/npm-base\.mts'|from '../../../../src/shadow/npm-base.mts'|g" test/unit/shadow/npm/bin.test.mts
sed -i '' "s|from '../../../../src/install\.mts'|from '../../../../src/shadow/npm/install.mts'|g" test/unit/shadow/npm/install.test.mts

# npx shadow tests  
sed -i '' "s|from '../../../../src/bin\.mts'|from '../../../../src/shadow/npx/bin.mts'|g" test/unit/shadow/npx/bin.test.mts
sed -i '' "s|from '../../../../src/npm-base\.mts'|from '../../../../src/shadow/npm-base.mts'|g" test/unit/shadow/npx/bin.test.mts

# pnpm shadow tests
sed -i '' "s|from '../../../../src/bin\.mts'|from '../../../../src/shadow/pnpm/bin.mts'|g" test/unit/shadow/pnpm/bin.test.mts

# yarn shadow tests  
sed -i '' "s|from '../../../../src/bin\.mts'|from '../../../../src/shadow/yarn/bin.mts'|g" test/unit/shadow/yarn/bin.test.mts

echo "Fixed shadow test imports"
