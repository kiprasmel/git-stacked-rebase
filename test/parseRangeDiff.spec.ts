#!/usr/bin/env ts-node-dev

import assert from "assert";

import { log } from "../util/log";
import { RangeDiffBase, parseRangeDiff } from "../ref-finder";

export async function parseRangeDiff_TC() {
	for (const testData of simpleTests) {
		log({ testData });

		const [lines, expectedOutput] = testData;

		const output = parseRangeDiff(lines.trim().split("\n"));
		assert.deepStrictEqual(output, expectedOutput);
	}
}

type SimpleTestInput = [lines: string, rangeDiff: RangeDiffBase[]];

const simpleTests: SimpleTestInput[] = [
	// https://git-scm.com/docs/git-range-diff#_examples
	[
		`
-:  ------- > 1:  0ddba11 Prepare for the inevitable!
1:  c0debee = 2:  cab005e Add a helpful message at the start
2:  f00dbal ! 3:  decafe1 Describe a bug
    @@ -1,3 +1,3 @@
     Author: A U Thor <author@example.com>

    -TODO: Describe a bug
    +Describe a bug
    @@ -324,5 +324,6
      This is expected.

    -+What is unexpected is that it will also crash.
    ++Unexpectedly, it also crashes. This is a bug, and the jury is
    ++still out there how to fix it best. See ticket #314 for details.

      Contact
3:  bedead < -:  ------- TO-UNDO
`,
		[
			{
				diff_lines: [],
				eq_sign: ">",
				msg: "Prepare for the inevitable!",
				nth_after: "1",
				nth_before: "-",
				sha_after: "-------",
				sha_before: "0ddba11",
			},
			{
				diff_lines: [],
				eq_sign: "=",
				msg: "Add a helpful message at the start",
				nth_after: "2",
				nth_before: "1",
				sha_after: "c0debee",
				sha_before: "cab005e",
			},
			{
				diff_lines: [
					"    @@ -1,3 +1,3 @@",
					"     Author: A U Thor <author@example.com>",
					"",
					"    -TODO: Describe a bug",
					"    +Describe a bug",
					"    @@ -324,5 +324,6",
					"      This is expected.",
					"",
					"    -+What is unexpected is that it will also crash.",
					"    ++Unexpectedly, it also crashes. This is a bug, and the jury is",
					"    ++still out there how to fix it best. See ticket #314 for details.",
					"",
					"      Contact",
				],
				eq_sign: "!",
				msg: "Describe a bug",
				nth_after: "3",
				nth_before: "2",
				sha_after: "f00dbal",
				sha_before: "decafe1",
			},
			{
				diff_lines: [],
				eq_sign: "<",
				msg: "TO-UNDO",
				nth_after: "-",
				nth_before: "3",
				sha_after: "bedead",
				sha_before: "-------",
			},
		],
	],

	//
];

if (!module.parent) {
	parseRangeDiff_TC();
}
