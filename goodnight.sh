#!/bin/sh

set -e

git branch -f nightly @
git push -f origin nightly

