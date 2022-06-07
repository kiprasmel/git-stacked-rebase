/**
 * initially extracted as test utils,
 * but i feel like these could be used to automate things
 * thru the CLI that would need to be done inside the
 * interactive mode.
 */

import fs from "fs";

import { RegularRebaseCommand } from "./parse-todo-of-stacked-rebase/validator";

type CommonArgs = {
	filePath: string; //
	commitSHA: string;
};

/**
 * TODO general "HumanOp" for `appendLineAfterNthCommit` & similar utils
 */
export function humanOpAppendLineAfterNthCommit(newLine: string, { filePath, commitSHA }: CommonArgs): void {
	const file = fs.readFileSync(filePath, { encoding: "utf-8" });
	const lines = file.split("\n");
	const lineIdx: number = lines.findIndex((line) => line.startsWith(`pick ${commitSHA}`));

	console.log("commitSHA: %s, lineIdx: %s, newLine: %s", commitSHA, lineIdx, newLine);

	lines.splice(lineIdx, 0, newLine);

	fs.writeFileSync(filePath, lines.join("\n"));
}

export function humanOpChangeCommandOfNthCommitInto(
	newCommand: RegularRebaseCommand,
	{ commitSHA, filePath }: CommonArgs
): void {
	const file = fs.readFileSync(filePath, { encoding: "utf-8" });
	const lines = file.split("\n");
	const lineIdx: number = lines.findIndex((line) => line.startsWith(`pick ${commitSHA}`));

	console.log("commitSHA: %s, lineIdx: %s, newCommand: %s", commitSHA, lineIdx, newCommand);

	const parts = lines[lineIdx].split(" ");
	parts[0] = newCommand;
	lines[lineIdx] = parts.join(" ");

	fs.writeFileSync(filePath, lines.join("\n"));
}
