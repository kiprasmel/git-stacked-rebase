#!/usr/bin/env ts-node-dev

const fs = require('fs')
const cp = require('child_process')
const util = require('util')

import { removeLocalAndRemoteRefPrefix } from "./git-stacked-rebase"

import { log } from "./util/log"

export const ignoreTags = (x: RefBase) => x.objtype !== 'tag'
export const ignoreTagLike = (x: RefBase) => !x.refname.startsWith('refs/tags/')
export const ignoreOutsideStack = (x: RefBase) => x.ref_exists_between_latest_and_initial
export const ignoreStash = (x: RefBase) => x.refname !== 'refs/stash'
export const ignoreRemotes = (x: RefBase) => !x.refname.startsWith('refs/remotes/')
export const ignoreIfDoNotNeedRepair = (x: RefBase) => !x.ref_is_directly_part_of_latest_branch

export const REF_PASSES_AUTO_REPAIR_FILTER = (x: RefBase) =>
	ignoreTags(x)
	&& ignoreTagLike(x)
	&& ignoreOutsideStack(x)
	&& ignoreStash(x)
	/**
	* TODO FIXME:
	* for now, ignore remote branches.
	* will need to handle divergence between local & remote later.
	*/
	&& ignoreRemotes(x)
	&& ignoreIfDoNotNeedRepair(x)

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
	process.on("unhandledRejection", (e) => {
		console.error(e)
		process.exit(1)
	})

	if (!INITIAL_BRANCH_COMMIT) INITIAL_BRANCH_COMMIT = await exec(`git rev-parse "${INITIAL_BRANCH}"`)
	if (!LATEST_BRANCH) LATEST_BRANCH = await exec(`git branch --show`)
	// if (!LATEST_BRANCH_COMMIT) LATEST_BRANCH_COMMIT = await exec(`git rev-parse "${LATEST_BRANCH}"`)

	const iniBranchInfo = "initial branch:\n" + INITIAL_BRANCH + "\n" + INITIAL_BRANCH_COMMIT + "\n\n"
	log(iniBranchInfo)

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

	const ALL_REF_DATA: ProcessedRef[] = await Promise.all(REF_PROMISES)
	const REF_DATA: RepairableRef[] = (ALL_REF_DATA
		.filter(r => r.can_be_auto_repaired) as RepairableRef[])

		//.filter(x => !x.ref_exists_between_latest_and_initial) // test
		//.filter(x => x.merge_base_to_initial_is_initial_branch && !x.ref_exists_between_latest_and_initial) // test

	// console.log(REF_DATA.map(x => Object.values(x).join(' ')))
	//console.log(REF_DATA)

	log(REF_DATA.length)

	const _ = require('lodash')

	const REF_DATA_BY_COMMIT = _.groupBy(REF_DATA, 'commit')
	//console.log(REF_DATA_BY_COMMIT)

	fs.writeFileSync('refout.json', JSON.stringify(REF_DATA_BY_COMMIT, null, 2), { encoding: 'utf-8' })
	fs.writeFileSync('refout.all.json', JSON.stringify(ALL_REF_DATA, null, 2), { encoding: 'utf-8' })

	//COMMIT_DATA_IN_LATEST_BRANCH = 

	return REF_DATA
}

export type RefBase = {
	commit: string;
	objtype: string;
	refname: string;
	refnameshort: string;
	merge_base_to_initial: string;
	merge_base_to_initial_is_initial_branch: boolean;
	merge_base_to_latest: string;
	merge_base_to_latest_to_initial: string;
	ref_exists_between_latest_and_initial: boolean;
	ref_is_directly_part_of_latest_branch: boolean;
}

export type RepairableRef = RefBase & {
	range_diff_between_ref__base_to_latest__head__base_to_latest: string[];
	range_diff_parsed: RangeDiff[];
	easy_repair_scenario: EasyScenarioRet;
}

export type ProcessedRef = (RefBase & { can_be_auto_repaired: false }) | (RepairableRef & { can_be_auto_repaired: true })

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
}: ProcessRefArgs): Promise<ProcessedRef> {
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

	const ref_base: RefBase = {
		commit: refCommit,
		objtype,
		refname,
		refnameshort: removeLocalAndRemoteRefPrefix(refname),
		merge_base_to_initial,
		merge_base_to_initial_is_initial_branch,
		merge_base_to_latest,
		merge_base_to_latest_to_initial,
		ref_exists_between_latest_and_initial,
		ref_is_directly_part_of_latest_branch,
	}

	const can_be_auto_repaired: boolean = REF_PASSES_AUTO_REPAIR_FILTER(ref_base)

	if (!can_be_auto_repaired) {
		/**
		 * will not be used as an auto-repairable ref,
		 * thus optimize perf by not computing the range diff et al.
		 */
		(ref_base as ProcessedRef).can_be_auto_repaired = can_be_auto_repaired
		return ref_base as ProcessedRef
		
	}

	const range_diff_cmd = `git range-diff ${refname}...${merge_base_to_latest} HEAD...${merge_base_to_latest}`
	const range_diff_between_ref__base_to_latest__head__base_to_latest: string[] = await exec(range_diff_cmd).then(processRangeDiff)

	const range_diff_parsed_base: RangeDiffBase[] = parseRangeDiff(range_diff_between_ref__base_to_latest__head__base_to_latest)
	const range_diff_parsed: RangeDiff[] = await enhanceRangeDiffsWithFullSHAs(range_diff_parsed_base)

	const easy_repair_scenario: EasyScenarioRet = checkIfIsEasyScenarioWhenCanAutoGenerateRewrittenList(range_diff_parsed)

	const ref: RepairableRef = Object.assign(ref_base, {
		range_diff_between_ref__base_to_latest__head__base_to_latest,
		easy_repair_scenario,
		range_diff_parsed,
	})

	log([
		merge_base_to_initial,
		merge_base_to_latest_to_initial,
		merge_base_to_latest,
		can_be_auto_repaired,
		ref_is_directly_part_of_latest_branch,
		'\n',
	].join(' '));

	(ref as ProcessedRef).can_be_auto_repaired = can_be_auto_repaired
	return (ref as ProcessedRef)
}

export const processRangeDiff = (x: string): string[] => x.trim().split('\n').map((x: string) => x.trim())

export type RangeDiffBase = {
	nth_before: string;
	sha_before: string;
	eq_sign: string;
	nth_after: string;
	sha_after: string;
	msg: string;
	diff_lines: string[];
}

/**
 * head = 9563f3a77c1d86093447893e6538e34d1a18dfd2
 * argv-parser-rewrite = f11914d1de05863fac52077a269e66590d92e319
 *
 * ```sh
 * MERGE_BASE=094cddc223e8de5926dbc810449373e614d4cdef git range-diff argv-parser-rewrite...$MERGE_BASE HEAD...$MERGE_BASE
 * ```
 */
export const parseRangeDiff = (lines: string[]): RangeDiffBase[] => {
	if (!lines.length || (lines.length === 1 && !lines[0])) {
		return []
	}

	const range_diffs: RangeDiffBase[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = replaceManySpacesToOne(lines[i])

		const [nth_before, tmp1, ...tmp2s] = line.split(":").map((x, i) => i < 2 ? x.trim() : x)
		const [sha_after, eq_sign, nth_after] = tmp1.split(" ")
		const [sha_before, ...msgs] = tmp2s.join(":").trim().split(" ")
		const msg = msgs.join(" ")

		const diff_lines: string[] = []

		if (eq_sign === "!") {
			while (++i < lines.length && !isNewRangeDiffLine(lines[i], nth_before)) {
				diff_lines.push(lines[i])
			}

			--i
		}

		const range_diff: RangeDiffBase = {
			nth_before,
			sha_before,
			eq_sign,
			nth_after,
			sha_after,
			msg,
			diff_lines,
		}

		range_diffs.push(range_diff)
	}

	return range_diffs
}

export type RangeDiff = RangeDiffBase & {
	sha_before_full: string;
	sha_after_full: string;
}

export const enhanceRangeDiffsWithFullSHAs = async (range_diffs: RangeDiffBase[]): Promise<RangeDiff[]> => {
	const short_shas: string[] = range_diffs.map(r => [r.sha_before, r.sha_after]).flat()
	const short_shas_list: string = short_shas.join(" ")
	const full_shas: string[] = await exec(`git rev-parse ${short_shas_list}`).then(x => x.split("\n"))

	let ret: RangeDiff[] = []
	for (let i = 0; i < range_diffs.length; i += 2) {
		ret.push({
			 ...range_diffs[i],
			 sha_before_full: full_shas[i],
			 sha_after_full: full_shas[i + 1]
		})
	}

	return ret
}

/**
 * TODO FIXME: can affect commit msg
 */
export const replaceManySpacesToOne = (x: string) => x.replace(/\s+/g, " ")

export const isNewRangeDiffLine = (line: string, nth_before: string) => {
	const nth_before_num = Number(nth_before)

	if (Number.isNaN(nth_before_num)) {
		return false
	}

	const next: number = nth_before_num + 1
	const expectedStart = `${next}: `

	return line.startsWith(expectedStart)
}

export type EasyScenarioRet = {
    is_easy_repair_scenario: boolean;
	//
    eq_from: number;
    eq_till: number;
    eq_count: number;
	//
    ahead_from: number;
    ahead_till: number;
    ahead_count: number;
	//
    behind_from: number;
    behind_till: number;
    behind_count: number;
}

export const checkIfIsEasyScenarioWhenCanAutoGenerateRewrittenList = (range_diffs: RangeDiff[]): EasyScenarioRet => {
	let i = 0
	const eq_from = i
	while (i < range_diffs.length && range_diffs[i].eq_sign === "=") {
		++i
	}
	const eq_till = i
	const eq_count = eq_till - eq_from

	// extra commits in diverged branch, that need to be integrated back into latest
	const ahead_from = i
	while (i < range_diffs.length && range_diffs[i].eq_sign === "<") {
		++i
	}
	const ahead_till = i
	const ahead_count = ahead_till - ahead_from

	const behind_from = i
	while (i < range_diffs.length && range_diffs[i].eq_sign === ">") {
		++i
	}
	const behind_till = i
	const behind_count = behind_till - behind_from

	const is_easy_repair_scenario = i === range_diffs.length

	return {
		is_easy_repair_scenario,
		//
		eq_from,
		eq_till,
		eq_count,
		//
		ahead_from,
		ahead_till,
		ahead_count,
		//
		behind_from,
		behind_till,
		behind_count,
	}
}

if (!module.parent) {
	refFinder()
}
