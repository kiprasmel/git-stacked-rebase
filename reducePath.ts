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
						throw new Error(
							`NOT IMPLEMENTED - identical key in 'amend' and 'rebase', but different values.`
						+ `(key = "${key}", amend's value = "${value}", rebase's value = "${list.mapping[key]}")`
						)
					}
				} else {
					if (Object.values(list.mapping).includes(key)) {
						/**
						 * add the single new entry of amend's mapping into rebase's mapping.
						 * it will get `reducePath`'d later.
						 */
						Object.assign(list.mapping, amend.mapping)
					} else {
						throw new Error(
							"NOT IMPLEMENTED - neither key nor value of 'amend' was included in the 'rebase'."
						+ "could be that we missed the ordering, or when we call 'reducePath', or something else."
						)
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
