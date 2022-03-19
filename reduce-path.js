#!/usr/bin/env node

/* eslint-disable */

const assert = require("assert")
const fs = require("fs")
const { execSync } = require("child_process")

const obj1 = {
	"a": "b",
	"b": "c",
	"c": "d",
	"d": "e",

	"g": "h",

	"x": "x",

	"y": "z",
	"z": "z",

	/**
	 * this might mean that we need to go backwards
	 * rather than forwards
	 * (multiple commits can be reported as rewritten into one,
	 * but i don't think the opposite is possible)
	 * 
	 * ~~and/or we might need another phase,
	 * because currently, A -> F,
	 * and both B and C stay at D.~~
	 * done
	 * 
	 */
	"A": "D",
	"B": "D",
	"C": "D",
	"D": "E",
	"E": "F",
}

reducePath(obj1)
console.log(obj1)
assert.deepStrictEqual(obj1, {
	"a": "e",

	"g": "h",

	"x": "x",

	"y": "z",

	"A": "F",
	"B": "F",
	"C": "F",
})

function reducePath(obj) {
	let prevSize = -Infinity
	let entries
	let keysMarkedForDeletion = new Set()

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

const prefix = "" // "test/.tmp-described.off/"
const rewrittenListFile = fs.readFileSync(prefix + ".git/stacked-rebase/rewritten-list", { encoding: "utf-8" })
console.log({ rewrittenListFile })

/**
 * $1 (amend/rebase)
 */
const extraOperatorLineCount = 1

const rewrittenLists = rewrittenListFile
	.split("\n\n")
	.map(lists => lists.split("\n"))
	.map(list => list[list.length - 1] === "" ? list.slice(0, -1) : list)
	// .slice(0, -1)
	.filter(list => list.length > extraOperatorLineCount)
	.map(list => ({
			type: list[0],
			mapping: Object.fromEntries(
				list.slice(1).map(line => line.split(" "))
			)
		})
	)
	// .map(list => Object.fromEntries(list))
console.log("rewrittenLists", rewrittenLists)

let prev = []
let mergedReducedRewrittenLists = []
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
		throw new Error(`invalid list type (got "${list.type}")`)
	}
}
/**
 * TODO handle multiple rebases
 * or, multiple separate files for each new rebase,
 * since could potentially lose some info if skipping partial steps?
 */

console.log("mergedReducedRewrittenLists", mergedReducedRewrittenLists)

const b4 = Object.keys(mergedReducedRewrittenLists[0].mapping)
const after = Object.values(mergedReducedRewrittenLists[0].mapping)

fs.writeFileSync("b4", b4.join("\n") + "\n")
fs.writeFileSync("after", after.join("\n") + "\n")

const N = after.length
console.log({ N })

execSync(`git log --pretty=format:"%H" | head -n ${N} | tac - > curr`)
execSync(`diff -us curr after`, { stdio: "inherit" })
