#!/usr/bin/env bash

INITIAL_BRANCH="master" # TODO
INITIAL_BRANCH_COMMIT="$(git rev-parse "$INITIAL_BRANCH")"

LATEST_BRANCH="$(git branch --show)"
LATEST_BRANCH_COMMIT="$(git rev-parse "$LATEST_BRANCH")"

printf "initial branch:\n$INITIAL_BRANCH_COMMIT\n\n"

# TODO:
# 1. go thru all version of latest branch in the stack, to check if 
#    lost partial branch has pointed to it, just a previous version
#   (means still in the stack, highly likely).
#
# TODO:
# 2. go thru all versions of all partial branches in the stack,
#    to check if lost partial branch has pointed to any of them,
#    just a previous version
#    (still somewhat likely that still belongs to the stack).
#
# TODO:
# 3. cache data for 1. and later 2., so that it doesn't take forever to compute.
#
# 

git for-each-ref --format='%(objectname) %(objecttype) %(refname)' | node -pe "
fs = require('fs')
cp = require('child_process')

const ignoreTags = x => x.objtype !== 'tag'
const ignoreTagLike = x => !x.refname.startsWith('refs/tags/')
const ignoreOutsideStack = x => x.ref_exists_between_latest_and_initial
const ignoreStash = x => x.refname !== 'refs/stash'

const REF_PASSES_FILTER = (x) =>
	ignoreTags(x)
	&& ignoreTagLike(x)
	&& ignoreOutsideStack(x)
	&& ignoreStash(x)

REF_DATA = fs.readFileSync(0).toString().split('\n').slice(0, -1).map(x => x.split(' ')).map(x => {
	const mergeBase = (a, b) => cp.execSync(\`git merge-base \${a} \${b}\`, {encoding: 'utf-8'}).trim();

	const merge_base_to_initial = mergeBase(x[0], \"$INITIAL_BRANCH\")
	const merge_base_to_initial_is_initial_branch = merge_base_to_initial === \"$INITIAL_BRANCH_COMMIT\";

	const merge_base_to_latest = mergeBase(x[0], \"$LATEST_BRANCH\")
	const merge_base_to_latest_to_initial = mergeBase(merge_base_to_latest, \"$INITIAL_BRANCH\")

	/** the main thing we're looking for: */
	const ref_exists_between_latest_and_initial =
		merge_base_to_latest_to_initial === \"$INITIAL_BRANCH_COMMIT\"
		&& merge_base_to_latest !== \"$INITIAL_BRANCH_COMMIT\" /** if merge base from ref to latest is initial, then ref does not exist inside latest. */

	/**
	 * if directly part of latest branch, then is inside the stack & has not diverged,
	 * thus no repairs are needed (to integrate it into the stack / latest branch)
	*/
	const ref_is_directly_part_of_latest_branch =
		ref_exists_between_latest_and_initial &&
		merge_base_to_latest === x[0]

	const ref = {
		commit: x[0],
		objtype: x[1],
		refname: x[2],
		merge_base_to_initial,
		merge_base_to_initial_is_initial_branch,
		merge_base_to_latest,
		merge_base_to_latest_to_initial,
		ref_exists_between_latest_and_initial,
		ref_is_directly_part_of_latest_branch,
	}

	process.stdout.write([
		merge_base_to_initial,
		merge_base_to_latest_to_initial,
		merge_base_to_latest,
		REF_PASSES_FILTER(ref),
		ref_is_directly_part_of_latest_branch,
		'\n',
	].join(' '))

	return ref
})
	.filter(REF_PASSES_FILTER)

	/**
	 * TODO FIXME:
	 * for now, ignore remote branches.
	 * will need to handle divergence between local & remote later.
	*/
	.filter(x => !x.refname.startsWith('refs/remotes/'))

	//.filter(x => !x.ref_exists_between_latest_and_initial) // test
	//.filter(x => x.merge_base_to_initial_is_initial_branch && !x.ref_exists_between_latest_and_initial) // test

// console.log(REF_DATA.map(x => Object.values(x).join(' ')))
//console.log(REF_DATA)

console.log(REF_DATA.length)

_ = require('lodash')

REF_DATA_BY_COMMIT = _.groupBy(REF_DATA, 'commit')
console.log(REF_DATA_BY_COMMIT)

//COMMIT_DATA_IN_LATEST_BRANCH = 

void 0

"
