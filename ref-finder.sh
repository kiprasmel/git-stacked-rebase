#!/usr/bin/env bash

INITIAL_BRANCH="master" # TODO
INITIAL_BRANCH_COMMIT="$(git rev-parse "$INITIAL_BRANCH")"

LATEST_BRANCH="$(git branch --show)"
LATEST_BRANCH_COMMIT="$(git rev-parse "$LATEST_BRANCH")"

printf "initial branch:\n$INITIAL_BRANCH_COMMIT\n\n"

git for-each-ref --format='%(objectname) %(objecttype) %(refname)' | node -pe "
fs = require('fs')
cp = require('child_process')

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

	process.stdout.write(merge_base_to_initial + ' ' + merge_base_to_latest + '\n')

	return {
		commit: x[0],
		objtype: x[1],
		refname: x[2],
		merge_base_to_initial,
		merge_base_to_initial_is_initial_branch,
		merge_base_to_latest,
		merge_base_to_latest_to_initial,
		ref_exists_between_latest_and_initial,
	}
})
	.filter(x => x.objtype !== 'tag') // ignore tags
	// .filter(x => x.merge_base_to_initial_is_initial_branch) // ignore branches where merge base is not our target
	//.filter(x => !x.ref_exists_between_latest_and_initial) // ignore branches where merge base is not our target

// console.log(REF_DATA.map(x => Object.values(x).join(' ')))
console.log(REF_DATA)

console.log(REF_DATA.length)

_ = require('lodash')

REF_DATA_BY_COMMIT = _.groupBy(REF_DATA, 'commit')
//console.log(REF_DATA_BY_COMMIT)

//COMMIT_DATA_IN_LATEST_BRANCH = 

void 0

"
