#!/usr/bin/env node

/* eslint-disable */

const assert = require("assert")
const fs = require("fs")

const obj1 = {
	"a": "b",
	"b": "c",
	"c": "d",
	"d": "e",

	"g": "h",

	"x": "x",

	"y": "z",
	"z": "z",
}

reducePath(obj1)
console.log(obj1)
assert.deepStrictEqual(obj1, { "a": "e", "g": "h", "x": "x", "y": "z" })

function reducePath(obj) {
	let prevSize = Infinity
	let entries

	// as long as it continues to improve
	while ((entries = Object.entries(obj)).length < prevSize) {
		prevSize = entries.length

		for (const [key, value] of entries) {
			const keyIsValue = key === value
			if (keyIsValue) {
				// would delete itself, thus skip
				continue
			}

			const gotReducedAlready = !(key in obj)
			if (gotReducedAlready) {
				continue
			}

			const valueIsAnotherKey = value in obj
			if (valueIsAnotherKey) {
				console.log("reducing. old:", key, "->", value, ";", value, "->", obj[value], "new:", key, "->", obj[value])
				// reduce
				obj[key] = obj[value]
				delete obj[value]
			}
		}
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

// const rewrittenLists = rewrittenListFile
// 	.split("\n---\n")
// 	.map(lines => lines.split("\n"))
// 	.map(lines => lines.slice(1)) // remove $1
// 	.filter(lines => lines.length && lines.every(line => line.length)) // remove empty "amend"
// console.log({ lists: rewrittenLists });

const rewrittenLists = rewrittenListFile
	.split("\n\n")
	.map(lists => lists.split("\n"))
	.map(list => list[list.length - 1] === "" ? list.slice(0, -1) : list)
	// .slice(0, -1)
	.filter(list => list.length)
	.map(list => list.map(line => line.split(" ")))
	.map(list => Object.fromEntries(list))
console.log({ rewrittenLists });

const reducedRewrittenLists = rewrittenLists
	// .map(list => (reducePath(list), list))
	.map(list => reducePath(list))

console.log({ reducedRewrittenLists });

const last = reducedRewrittenLists[reducedRewrittenLists.length - 1]
const lastVals = Object.values(last).reverse()
console.log({ lastVals });
/**
 * compare with
 * git log --pretty=format:"%H"
 */

/**
 * ayo lol, prolly found a bug in git -- the output in
 * rewritten-list, or /dev/stdin, after the rebase is done,
 * is not fully complete -- it doesn't correctly print the SHAs
 * that got changed while the rebase was paused,
 * e.g. commit --amend while paused by "edit" or "break" commands.
 * 
 * thus, at least until we report it and confirm it's actually a bug
 * and not intended this way,
 * we can get the desired output for ourselves
 * by merging all the rewrittenLists!
 * 
 */

/** 
 * TODO verify keys/values are not identical in a bad way
 */
const merge = (A, B) => ({
	...A,
	...B
})

const mergedReducedRewrittenLists = reducedRewrittenLists.reduce((acc, curr) => reducePath(merge(acc, curr)), {})

console.log({ mergedReducedRewrittenLists });
const vals = Object.values(mergedReducedRewrittenLists).reverse()
console.log({ vals });

/**
 * it fixes the above issues!
 * 
 * but wait! we cannot just merge like this,
 * because when we take the values,
 * the commits whom were not the full list (and only 1 commit remap, because --amend,
 * or not full rebase up till the initial branch (TODO need to confirm the 2nd case)),
 * end up being in the wrong place (they end up either in the start or the end).
 * 
 * the problem is that we don't know __when__ the rewrite of the commit happened.
 * TODO need to track that as well?
 * 
 */
