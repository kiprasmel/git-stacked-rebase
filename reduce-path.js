#!/usr/bin/env node

/* eslint-disable */

const assert = require("assert")

const obj1 = {
	"a": "b",
	"b": "c",
	"c": "d",
	"d": "e",

	"g": "h",
}

reducePath(obj1)
console.log(obj1)
assert.deepStrictEqual(obj1, { "a": "e", "g": "h" })

function reducePath(obj) {
	let prevSize = Infinity
	let entries

	// as long as it continues to improve
	while ((entries = Object.entries(obj)).length < prevSize) {
		prevSize = entries.length

		for (const [key, value] of entries) {
			const gotReducedAlready = !(key in obj)
			if (gotReducedAlready) {
				continue
			}

			const valueIsAnotherKey = value in obj
			if (valueIsAnotherKey) {
				// reduce
				obj[key] = obj[value]
				delete obj[value]
			}
		}
	}
}

const obj2 = {
	// original git log --pretty="format:%H" (NOTE! newest to oldest)
	"9991de74cfc1e49b179dc84b6781a9f96b404f11": "9991de74cfc1e49b179dc84b6781a9f96b404f11",
	"33ccec0597809093a747d50fd50cb2c541b8410d": "33ccec0597809093a747d50fd50cb2c541b8410d",
	"faa4c9eab2e88a17863bf228c7aaec2ea5b10105": "faa4c9eab2e88a17863bf228c7aaec2ea5b10105",
	"53fcfda81f332a2cc1dda029f111ef68b8d420c2": "53fcfda81f332a2cc1dda029f111ef68b8d420c2",
	// break + commit new + amend new
	"c0316d944cfe60072cce68314b6b5b98f763dcf0": "c0316d944cfe60072cce68314b6b5b98f763dcf0",
	"c43371edad9fba2d1a92f331587c297cbed8b061": "c43371edad9fba2d1a92f331587c297cbed8b061",
	"8836773af698905372b8284afeed2df8f2685842": "8836773af698905372b8284afeed2df8f2685842",
	"b10448d1db22b01c21e27043a0d7c6d7072d0adb": "b10448d1db22b01c21e27043a0d7c6d7072d0adb",  // reword
	"713145824cf7fd2d120b9a051cb3d518901cc951": "713145824cf7fd2d120b9a051cb3d518901cc951",
	"661ff363a859694a0c7ab56198cc1812f591bdd0": "661ff363a859694a0c7ab56198cc1812f591bdd0",
	"7a425ca01afc0352757e0996533e014156b2b74f": "7a425ca01afc0352757e0996533e014156b2b74f",
	"e5933fe148db4502762536cb5267d6872d357636": "e5933fe148db4502762536cb5267d6872d357636",
	"c145226b4dccfbd9643218b9685de0721a728a93": "c145226b4dccfbd9643218b9685de0721a728a93",
	"183c58def91293dff605ed1c4a4639214e07ad0e": "183c58def91293dff605ed1c4a4639214e07ad0e",
	"3ac39e60ea4a4419ea2bd45f046ae5253db28b31": "3ac39e60ea4a4419ea2bd45f046ae5253db28b31",
	"6775d4aed6207b75774fecc3329c4a723c1499f0": "6775d4aed6207b75774fecc3329c4a723c1499f0",


	// reword ($1 => amend)
	"b10448d1db22b01c21e27043a0d7c6d7072d0adb": "987f8c8682d721e9b50c2fae2828aa28e6c0c144",

	// break
	// new commit "t1"

	// amend (the new commit "t1")
	"15c81ce2c8880006eb8a74ec7d71251a856eef63": "b902571d8bef8f2209880daf51730da3f02bd9b3",

	// git rebase --continue (finishes) (NOTE! oldest to newest)
	"b10448d1db22b01c21e27043a0d7c6d7072d0adb": "987f8c8682d721e9b50c2fae2828aa28e6c0c144",
	"8836773af698905372b8284afeed2df8f2685842": "6d3d4acce8a660e7b904b4e3b0d7d43394c20b0d",
	"c43371edad9fba2d1a92f331587c297cbed8b061": "e3b3c1b8adfa4300c939624530395d553ffa911a",
	"c0316d944cfe60072cce68314b6b5b98f763dcf0": "32a8c3b42bca173611582e2e464eb7abca19d76a",
	"53fcfda81f332a2cc1dda029f111ef68b8d420c2": "bafdb356c77a481aaeaab0fef59189337b66c5d3",
	"faa4c9eab2e88a17863bf228c7aaec2ea5b10105": "85110af252f814d3537b7f41653e3b9624799bcb",
	"33ccec0597809093a747d50fd50cb2c541b8410d": "28a2cd3d5ae4407eee50d7ecbec47b0d1ad08fd4",
	"9991de74cfc1e49b179dc84b6781a9f96b404f11": "fa5422455629d33442669ecaba689ad6817224df",
}

reducePath(obj2)
console.log(obj2)

const obj2afterGitLog = {
	"fa5422455629d33442669ecaba689ad6817224df": "fa5422455629d33442669ecaba689ad6817224df",
	"28a2cd3d5ae4407eee50d7ecbec47b0d1ad08fd4": "28a2cd3d5ae4407eee50d7ecbec47b0d1ad08fd4",
	"85110af252f814d3537b7f41653e3b9624799bcb": "85110af252f814d3537b7f41653e3b9624799bcb",
	"bafdb356c77a481aaeaab0fef59189337b66c5d3": "bafdb356c77a481aaeaab0fef59189337b66c5d3",
	"b902571d8bef8f2209880daf51730da3f02bd9b3": "b902571d8bef8f2209880daf51730da3f02bd9b3",
	"32a8c3b42bca173611582e2e464eb7abca19d76a": "32a8c3b42bca173611582e2e464eb7abca19d76a",
	"e3b3c1b8adfa4300c939624530395d553ffa911a": "e3b3c1b8adfa4300c939624530395d553ffa911a",
	"6d3d4acce8a660e7b904b4e3b0d7d43394c20b0d": "6d3d4acce8a660e7b904b4e3b0d7d43394c20b0d",
	"987f8c8682d721e9b50c2fae2828aa28e6c0c144": "987f8c8682d721e9b50c2fae2828aa28e6c0c144",
	"713145824cf7fd2d120b9a051cb3d518901cc951": "713145824cf7fd2d120b9a051cb3d518901cc951",
	"661ff363a859694a0c7ab56198cc1812f591bdd0": "661ff363a859694a0c7ab56198cc1812f591bdd0",
	"7a425ca01afc0352757e0996533e014156b2b74f": "7a425ca01afc0352757e0996533e014156b2b74f",
	"e5933fe148db4502762536cb5267d6872d357636": "e5933fe148db4502762536cb5267d6872d357636",
	"c145226b4dccfbd9643218b9685de0721a728a93": "c145226b4dccfbd9643218b9685de0721a728a93",
	"183c58def91293dff605ed1c4a4639214e07ad0e": "183c58def91293dff605ed1c4a4639214e07ad0e",
	"3ac39e60ea4a4419ea2bd45f046ae5253db28b31": "3ac39e60ea4a4419ea2bd45f046ae5253db28b31",
	"6775d4aed6207b75774fecc3329c4a723c1499f0": "6775d4aed6207b75774fecc3329c4a723c1499f0",
}

assert.deepStrictEqual(Object.values(obj2), Object.values(obj2afterGitLog))

// "b902571d8bef8f2209880daf51730da3f02bd9b3"
