#!/usr/bin/env ts-node-dev

const fs = require('fs')
const cp = require('child_process')
const util = require('util')

export const ignoreTags = (x: Ref) => x.objtype !== 'tag'
export const ignoreTagLike = (x: Ref) => !x.refname.startsWith('refs/tags/')
export const ignoreOutsideStack = (x: Ref) => x.ref_exists_between_latest_and_initial
export const ignoreStash = (x: Ref) => x.refname !== 'refs/stash'

export const REF_PASSES_FILTER = (x: Ref) =>
	ignoreTags(x)
	&& ignoreTagLike(x)
	&& ignoreOutsideStack(x)
	&& ignoreStash(x)

export const execAsync = util.promisify(cp.exec)
export const exec = async (cmd: string, extra = {}) => (await execAsync(cmd, { encoding: 'utf-8', ...extra })).stdout.trim()
export const mergeBase = async (a: string, b: string, extra: string = '') => await exec(`git merge-base ${extra} ${a} ${b}`)

export const gitRefFormat = "%(objectname) %(objecttype) %(refname)"
export type GitRefOutputLine = [string, string, string]

/**
 * TODO:
 * 1. go thru all version of latest branch in the stack, to check if 
 *    lost partial branch has pointed to it, just a previous version
 *   (means still in the stack, highly likely).
 *
 * TODO:
 * 2. go thru all versions of all partial branches in the stack,
 *    to check if lost partial branch has pointed to any of them,
 *    just a previous version
 *    (still somewhat likely that still belongs to the stack).
 *
 * TODO:
 * 3. cache data for 1. and later 2., so that it doesn't take forever to compute.
 *
 */
export async function refFinder({
	INITIAL_BRANCH = "master",
	INITIAL_BRANCH_COMMIT = '',
	LATEST_BRANCH = '',
	// LATEST_BRANCH_COMMIT = '',
} = {}) {
	// process.on("unhandledRejection", () => process.exit(1))

	if (!INITIAL_BRANCH_COMMIT) INITIAL_BRANCH_COMMIT = await exec(`git rev-parse "${INITIAL_BRANCH}"`)
	if (!LATEST_BRANCH) LATEST_BRANCH = await exec(`git branch --show`)
	// if (!LATEST_BRANCH_COMMIT) LATEST_BRANCH_COMMIT = await exec(`git rev-parse "${LATEST_BRANCH}"`)

	process.stdout.write(`initial branch:\n${INITIAL_BRANCH_COMMIT}\n\n`)

	const STDIN: GitRefOutputLine[] = (await exec(`git for-each-ref --format="${gitRefFormat}"`))
		.split('\n')
		.slice(0, -1)
		.map((x: string): GitRefOutputLine => x.split(' ') as GitRefOutputLine)

	const REF_PROMISES = STDIN.map(x => processRef(x, {
		INITIAL_BRANCH,
		INITIAL_BRANCH_COMMIT,
		LATEST_BRANCH,
		// LATEST_BRANCH_COMMIT,
	}))

	const ALL_REF_DATA: Ref[] = await Promise.all(REF_PROMISES)
	const REF_DATA: Ref[] = ALL_REF_DATA
		.filter(REF_PASSES_FILTER)

		/**
		* TODO FIXME:
		* for now, ignore remote branches.
		* will need to handle divergence between local & remote later.
		*/
		.filter(x => !x.refname.startsWith('refs/remotes/'))

		//.filter(x => !x.ref_exists_between_latest_and_initial) // test
		//.filter(x => x.merge_base_to_initial_is_initial_branch && !x.ref_exists_between_latest_and_initial) // test
		.filter(x => !x.ref_is_directly_part_of_latest_branch) // test

	// console.log(REF_DATA.map(x => Object.values(x).join(' ')))
	//console.log(REF_DATA)

	console.log(REF_DATA.length)

	const _ = require('lodash')

	const REF_DATA_BY_COMMIT = _.groupBy(REF_DATA, 'commit')
	console.log(REF_DATA_BY_COMMIT)

	fs.writeFileSync('refout.json', JSON.stringify(REF_DATA_BY_COMMIT, null, 2), { encoding: 'utf-8' })

	//COMMIT_DATA_IN_LATEST_BRANCH = 
}

export type Ref = {
	commit: string;
	objtype: string;
	refname: string;
	merge_base_to_initial: string;
	merge_base_to_initial_is_initial_branch: boolean;
	merge_base_to_latest: string;
	merge_base_to_latest_to_initial: string;
	ref_exists_between_latest_and_initial: boolean;
	ref_is_directly_part_of_latest_branch: boolean;
	range_diff_between_ref__base_to_latest__head__base_to_latest: string[];
}

export type ProcessRefArgs = {
	INITIAL_BRANCH: string;
	INITIAL_BRANCH_COMMIT: string;
	LATEST_BRANCH: string;
}

export async function processRef(x: GitRefOutputLine, {
	INITIAL_BRANCH, //
	INITIAL_BRANCH_COMMIT,
	LATEST_BRANCH,
	// LATEST_BRANCH_COMMIT,
}: ProcessRefArgs): Promise<Ref> {
	const refCommit = x[0]
	const objtype = x[1]
	const refname = x[2]

	const merge_base_to_initial = await mergeBase(refCommit, INITIAL_BRANCH)
	const merge_base_to_initial_is_initial_branch = merge_base_to_initial === INITIAL_BRANCH_COMMIT

	const merge_base_to_latest = await mergeBase(refCommit, LATEST_BRANCH)
	const merge_base_to_latest_to_initial = await mergeBase(merge_base_to_latest, INITIAL_BRANCH)

	/** the main thing we're looking for: */
	const ref_exists_between_latest_and_initial =
		merge_base_to_latest_to_initial === INITIAL_BRANCH_COMMIT
		&& merge_base_to_latest !== INITIAL_BRANCH_COMMIT /** if merge base from ref to latest is initial, then ref does not exist inside latest. */

	/**
	 * if directly part of latest branch, then is inside the stack & has not diverged,
	 * thus no repairs are needed (to integrate it into the stack / latest branch)
	*/
	const ref_is_directly_part_of_latest_branch =
		ref_exists_between_latest_and_initial &&
		merge_base_to_latest === refCommit

	const range_diff_cmd = `git range-diff ${refname}...${merge_base_to_latest} HEAD...${merge_base_to_latest}`
	const range_diff_between_ref__base_to_latest__head__base_to_latest: string[] = await exec(range_diff_cmd).then(processRangeDiff)

	const ref: Ref = {
		commit: refCommit,
		objtype,
		refname,
		merge_base_to_initial,
		merge_base_to_initial_is_initial_branch,
		merge_base_to_latest,
		merge_base_to_latest_to_initial,
		ref_exists_between_latest_and_initial,
		ref_is_directly_part_of_latest_branch,
		range_diff_between_ref__base_to_latest__head__base_to_latest,
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
}

export const processRangeDiff = (x: string): string[] => x.split('\n').map((x: string) => x.trim())

if (!module.parent) {
	refFinder()
}
