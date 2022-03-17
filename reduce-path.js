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
	.map(list => (reducePath(list), list))

console.log({ reducedRewrittenLists });
