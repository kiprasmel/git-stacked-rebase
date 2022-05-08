#!/bin/sh

# meant for CONSUMERS,
# NOT UPDATERS!

git checkout nightly
git pull --rebase

yarn
yarn --cwd nvim-git-rebase-todo
yarn --cwd git-reconcile-rewritten-list

yarn build

## https://stackoverflow.com/a/69259147/9285308
#yarn global add link:.

# https://github.com/yarnpkg/yarn/issues/3256#issuecomment-433096967
yarn global add file:$PWD
