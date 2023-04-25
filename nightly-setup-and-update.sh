#!/bin/sh

# meant for users of GSR;
# for updating nightly - use ./goodnight.sh

git checkout nightly
git pull --rebase

yarn install:all
yarn build

## https://stackoverflow.com/a/69259147/9285308
#yarn global add link:.

# https://github.com/yarnpkg/yarn/issues/3256#issuecomment-433096967
yarn global add file:$PWD
