#!/usr/bin/env ts-node-dev

import assert from "assert";

import { log } from "../util/log";
import { RangeDiff, parseRangeDiff } from "../ref-finder";

export async function parseRangeDiff_TC() {
	for (const testData of simpleTests) {
		log({ testData });

		const [lines, expectedOutput] = testData;

		const output = parseRangeDiff(lines.trim().split("\n"));
		assert.deepStrictEqual(output, expectedOutput);
	}
}

type SimpleTestInput = [lines: string, rangeDiff: RangeDiff[]];

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
				sha_after: "0ddba11",
				sha_before: "-------",
			},
			{
				diff_lines: [],
				eq_sign: "=",
				msg: "Add a helpful message at the start",
				nth_after: "2",
				nth_before: "1",
				sha_after: "cab005e",
				sha_before: "c0debee",
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
				sha_after: "decafe1",
				sha_before: "f00dbal",
			},
			{
				nth_before: "3",
				sha_before: "bedead",
				eq_sign: "<",
				nth_after: "-",
				sha_after: "-------",
				msg: "TO-UNDO",
				diff_lines: [],
			},
		],
	],

	//
];

if (!module.parent) {
	parseRangeDiff_TC();
}
