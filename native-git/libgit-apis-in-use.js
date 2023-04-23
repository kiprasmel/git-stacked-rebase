#!/usr/bin/env node

/**
 *
 * how hard would be to get rid of libgit?
 *
 * 1. libgit2 project itself is kinda dead...
 * - v much outdated from core git
 * - many issues not fixed
 * - updates not coming, even to the previously pretty up-to-date nodegit pkg
 * - issues not being closed or even addressed, just dead vibes all around..
 *
 * 2. building is a chore, takes up almost 90MB,
 *    breaks between node versions & needs re-build for each...
 */

fs = require("fs")
cp = require("child_process")
_ = require("lodash")

SHORT = !!process.env.SHORT

fnCalls = cp.execSync(`rg "Git\\.\\w+\\.\\w+" . -o --no-line-number --no-filename`)
typeUsages = cp.execSync(`rg ": Git\\.\\w+" . -o --no-line-number --no-filename`)
fnRetTypes = cp.execSync(`rg "=> Git\\.\\w+" . -o --no-line-number --no-filename`)

prep = x => x.toString().split('\n').filter(x => !!x)
sort = (A, B) => A.group.localeCompare(B.group)

fnCallsSorted = prep(fnCalls)
	.map(x => ({
		full: x,
		group: x.split(".").slice(1,2).join("."),
		api: x.split(".").slice(2).join("."),
		kind: "fn_call",
	}))
	.sort(sort)

typeUsagesSorted = prep(typeUsages)
	.map(x => x.slice(2))
	.map(x => ({
		full: x,
		group: x.split(".").slice(1,2).join("."),
		kind: "type_usage",
	}))
	.sort(sort)

fnRetTypesSorted = prep(fnRetTypes)
	.map(x => x.slice(3))
	.map(x => ({
		full: x,
		group: x.split(".").slice(1,2).join("."),
		kind: "fn_ret_type",
	}))
	.sort(sort)

//

Array.prototype.collect = function collect(cb) {
	return cb(this)
}

mergedGroupedObjs = fnCallsSorted.concat(typeUsagesSorted).concat(fnRetTypesSorted)
	.sort(sort)
	.collect(merged => Object.entries(_.groupBy(merged, "group")))
	.collect(mergedGrouped => mergedGrouped.map(([group, items]) => ({
		cnt: items.length,
		group,
		// cnt_fn_call: items.filter(x => x.kind === "fn_call").length,
		// cnt_type_usage: items.filter(x => x.kind === "type_usage").length,
		// cnt_fn_ret_type: items.filter(x => x.kind === "fn_ret_type").length,
		// cnts: [items.filter(x => x.kind === "fn_call").length,
		// 	items.filter(x => x.kind === "type_usage").length,
		// 	items.filter(x => x.kind === "fn_ret_type").length],
		items,
	}))
	.sort((A, B) => B.cnt - A.cnt))

sum = (acc, curr) => acc + curr
totalCount = mergedGroupedObjs.map(x => x.cnt).reduce(sum, 0)

// detailed:
for (const group of mergedGroupedObjs) {
	process.stdout.write(group.cnt + " " + group.group + "\n")

	const groupedItems = Object.entries(_.groupBy(group.items, "kind"))

	for (let [kind, items] of groupedItems) {
		let extra = ""
		if (kind === "fn_call") {
			extra += Object.entries(_.groupBy(items, "api"))
				.sort((A, B) => B[1].length - A[1].length)
				.map(([api, apiItems]) => `\n${" ".repeat(8)}${apiItems.length} ${api}`)
				.join("")

			kind = SHORT ? "()" : (kind + "()")
		} else if (kind === "type_usage") {
			kind = SHORT ? ":" : (":" + kind)
		} else if (kind === "fn_ret_type") {
			kind = SHORT ? "=>" : ("=>" + kind)
		}

		process.stdout.write(" ".repeat(4) + items.length + " " + kind + extra + "\n")
	}

	process.stdout.write("\n")
}

// basic, quick overview
console.log({mergedGroupedObjs})

// full
// console.log("mergedGroupedObjs", JSON.stringify(mergedGroupedObjs, null, 2))

console.log({totalCount})
