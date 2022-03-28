#!/usr/bin/env ts-node-dev

/* eslint-disable */

import assert from "assert"
import fs from "fs"
import { execSync } from "child_process"

export type StringFromToMap = { [key: string]: string }

/**
 * mutates `obj` and returns it too
 */
export function reducePath(obj: StringFromToMap): StringFromToMap {
	let prevSize             : number             = -Infinity
	let entries              : [string, string][]
	let keysMarkedForDeletion: Set<string>        = new Set<string>()

	// as long as it continues to improve
	while (keysMarkedForDeletion.size > prevSize) {
		prevSize = keysMarkedForDeletion.size
		entries = Object.entries(obj)

		for (const [key, value] of entries) {
			const keyIsValue = key === value
			if (keyIsValue) {
				// would delete itself, thus skip
				continue
			}

			// const gotReducedAlready = !(key in obj)
			// if (gotReducedAlready) {
			// 	continue
			// }

			const valueIsAnotherKey = value in obj
			if (valueIsAnotherKey) {
				console.log("reducing. old:", key, "->", value, ";", value, "->", obj[value], "new:", key, "->", obj[value])
				// reduce
				obj[key] = obj[value]
				keysMarkedForDeletion.add(value)
			}
		}
	}

	for (const key of keysMarkedForDeletion.keys()) {
		delete obj[key]
	}

	/**
	 * we mutate the object, so NOT returning it makes it clear
	 * that this function causes a side-effect (mutates the original object).
	 * 
	 * but, in multiple cases when mapping, we forget to return the object,
	 * so instead we'll do it here:
	 */
	return obj
}

export type RewrittenListBlockBase = {
	mapping: StringFromToMap
}
export type RewrittenListBlockAmend = RewrittenListBlockBase & {
	type: "amend"
}
export type RewrittenListBlockRebase = RewrittenListBlockBase & {
	type: "rebase"
}
export type RewrittenListBlock = RewrittenListBlockAmend | RewrittenListBlockRebase

export type CombineRewrittenListsRet = {
	/**
	 * notice that this only includes rebases, no amends --
	 * that's the whole point.
	 * 
	 * further, probably only the 1st one is necessary,
	 * because it's likely that we'll start creating separate files for new rebases,
	 * or that might not be needed at all, because we might be able to
	 * --apply after every rebase, no matter if the user exited or not,
	 * thus we'd always have only 1 "rebase" block in the rewritten list.
	 */
	mergedReducedRewrittenLists: RewrittenListBlockRebase[],

	/**
	 * the git's standard represantation of the rewritten-list
	 * (no extras of ours)
	 */
	combinedRewrittenList: string,
}
export function combineRewrittenLists(rewrittenListFileContent: string): CombineRewrittenListsRet {
	/**
	 * $1 (amend/rebase)
	 */
	const extraOperatorLineCount = 1 as const

	const rewrittenLists: RewrittenListBlock[] = rewrittenListFileContent
		.split("\n\n")
		.map(lists => lists.split("\n"))
		.map(list => list[list.length - 1] === "" ? list.slice(0, -1) : list)
		// .slice(0, -1)
		.filter(list => list.length > extraOperatorLineCount)
		.map((list): RewrittenListBlock => ({
				type: list[0] as RewrittenListBlock["type"],
				mapping: Object.fromEntries<string>(
					list.slice(1).map(line => line.split(" ") as [string, string])
				)
			})
		)
		// .map(list => Object.fromEntries(list))
	console.log("rewrittenLists", rewrittenLists)

	let prev                       : RewrittenListBlockAmend[]  = []
	let mergedReducedRewrittenLists: RewrittenListBlockRebase[] = []

	for (const list of rewrittenLists) {
		if (list.type === "amend") {
			prev.push(list)
		} else if (list.type === "rebase") {
			/**
			 * merging time
			 */
			for (const amend of prev) {
				assert.equal(Object.keys(amend.mapping).length, 1)

				const [key, value] = Object.entries(amend.mapping)[0]

				/**
				 * (try to) merge
				 */
				if (key in list.mapping) {
					if (value === list.mapping[key]) {
						// pointless
						continue
					} else {
						//throw new Error(
						//	`NOT IMPLEMENTED - identical key in 'amend' and 'rebase', but different values.`
						//+ `(key = "${key}", amend's value = "${value}", rebase's value = "${list.mapping[key]}")`
						//)

						/**
						 * amend
						 * A->B
						 *
						 * rebase
						 * A->C
						 *
						 *
						 * hmm.
						 * will we need to keep track of _when_ the post-rewrite happened as well?
						 * (i.e. on what commit)
						 * though, idk if that's possible, i think i already tried,
						 * but since the post-rewrite script is called _after_ the amend/rebase happens,
						 * it gives you the same commit that you already have,
						 * i.e. the already rewritten one, instead of the previous one...
						 *
						 */

						/**
						 * for starters, we can try always favoring the amend over rebase
						 */
						Object.assign(list.mapping, amend.mapping)

					}
				} else {
					if (Object.values(list.mapping).includes(key)) {
						if (Object.values(list.mapping).includes(value)) {

							console.warn(`value already in values`, {
								[key]: value,
								[Object.entries(list.mapping).find(([_k, v]) => v === value)![0]]: value,
							})
							// continue
							// throw;

							/**
							 * happened when:
							 * mark "edit" on commit A and B,
							 * reach commit A,
							 * do git commit --amend to change the title,
							 * continue to commit B,
							 * stop because of the another "edit",
							 * reset to HEAD~ (commit A) (changes kept in workdir),
							 * add all changes,
							 * git commit --amend them into commit A.
							 * 
							 * how things ended up in the rewritten-list, was that:
							 * 
							 * amend
							 * TMP_SHA -> NEW_SHA
							 * 
							 * rebase
							 * COMMIT_A_SHA -> TMP_SHA
							 * COMMIT_B_SHA -> NEW_SHA
							 * 
							 * 
							 * and would end up as
							 * 
							 * COMMIT_A_SHA -> NEW_SHA
							 * COMMIT_B_SHA -> NEW_SHA
							 * 
							 * from our `git-rebase-todo` file, the ~~OLD_SHA_2~~ COMMIT_B_SHA was the original one found,
							 * BUT, it pointed to commit B, not commit A!
							 * 
							 * there were more mappings in the rewritten-list that included the commit A's SHA...
							 * this is getting complicated.
							 * 
							 * ---rm
							 * the 1st mapping of TMP_SHA -> NEW_SHA ended up first in the rewritten-list inside an "amend".
							 * the 2nd mapping of OLD_SHA_2 -> NEW_SHA ended up second in the rewritten-list inside the "rebase".
							 * ---
							 * 
							 * 
							 * TODO needs more testing.
							 * 
							 * i mean, we very well could just get rid of the key->value pair
							 * if there exists another one with the same value,
							 * but how do we know which key to keep?
							 * 
							 * wait... you keep the earliest key?
							 * 
							 */
							// fwiw, i don't think this algo makes you keep the earliest key (or does it?)
							Object.entries(list.mapping).forEach(([k, v]) => {
								if (v === value && k !== key) {
									// if it's not our key, delete it
									// (our key will get assigned a new value below.)
									console.info("deleting entry because duplicate A->B, C->A, D->B, ends up C->B, D->B, keeping only one", {
										[k]: list.mapping[k],
									})
									delete list.mapping[k]
								}
							})
							/**
							 * TODO test if you "fixup" (reset, add, amend) first --
							 * does this reverse the order & you'd need the last key?
							 * 
							 * TODO what if you did both and you need a key from the middle? lol
							 * 
							 */
						}

						/**
						 * add the single new entry of amend's mapping into rebase's mapping.
						 * it will get `reducePath`'d later.
						 */
						Object.assign(list.mapping, amend.mapping)
					} else {
						if (Object.values(list.mapping).includes(value)) {
							/**
							 * TODO needs more testing.
							 * especially which one is the actually newer one -- same questions apply as above.
							 */
							console.warn("the `rebase`'s mapping got a newer value than the amend, apparently. continuing.", {
								[key]: value,
								[Object.entries(list.mapping).find(([_k, v]) => v === value)![0]]: value,
							})
							continue
						} else {
							console.warn(
								"NOT IMPLEMENTED - neither key nor value of 'amend' was included in the 'rebase'."
								+ "\ncould be that we missed the ordering, or when we call 'reducePath', or something else.",
							{
								[key]: value,
							})

							/**
							 * i think this happens when commit gets rewritten,
							 * then amended, and amended again.
							 * 
							 * looks like it's fine to ignore it.
							 */
							continue
						}
					}
				}
			}

			prev = []
			reducePath(list.mapping)
			mergedReducedRewrittenLists.push(list)
		} else {
			throw new Error(`invalid list type (got "${(list as any).type}")`)
		}
	}
	/**
	 * TODO handle multiple rebases
	 * or, multiple separate files for each new rebase,
	 * since could potentially lose some info if skipping partial steps?
	 */

	console.log("mergedReducedRewrittenLists", mergedReducedRewrittenLists)

	const combinedRewrittenList = Object.entries(mergedReducedRewrittenLists[0].mapping).map(([k, v]) => k + " " + v).join("\n") + "\n"
	// fs.writeFileSync("rewritten-list", combinedRewrittenList)

	return {
		mergedReducedRewrittenLists,
		combinedRewrittenList,
	}
}

if (!module.parent) {
	const prefix = "" // "test/.tmp-described.off/"
	const rewrittenListFile = fs.readFileSync(prefix + ".git/stacked-rebase/rewritten-list", { encoding: "utf-8" })
	console.log({ rewrittenListFile })

	const { mergedReducedRewrittenLists } = combineRewrittenLists(rewrittenListFile)

	const b4 = Object.keys(mergedReducedRewrittenLists[0].mapping)
	const after = Object.values(mergedReducedRewrittenLists[0].mapping)

	const path = require("path")
	const os = require("os")
	const dir = path.join(os.tmpdir(), "gsr-reduce-path")
	fs.mkdirSync(dir, { recursive: true })
	
	const b4path    = path.join(dir, "b4")
	const afterpath = path.join(dir, "after")
	fs.writeFileSync(b4path   , b4   .join("\n") + "\n")
	fs.writeFileSync(afterpath, after.join("\n") + "\n")

	const N = after.length
	console.log({ N })

	const currpath = path.join(dir, "curr")
	execSync(`git log --pretty=format:"%H" | head -n ${N} | tac - > ${currpath}`)
	execSync(`diff -us ${currpath} ${afterpath}`, { stdio: "inherit" })
}
