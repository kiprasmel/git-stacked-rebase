/**
 * initially extracted as test utils,
 * but i feel like these could be used to automate things
 * thru the CLI that would need to be done inside the
 * interactive mode.
 */

import fs from "fs";

import { RegularRebaseCommand } from "./parse-todo-of-stacked-rebase/validator";

import { log } from "./util/log";

type CommonArgs = {
	filePath: string; //
	commitSHA: string;
};

/**
 * TODO general "HumanOp" for `appendLineAfterNthCommit` & similar utils
 */
export function humanOpAppendLineAfterNthCommit(newLine: string, { filePath, commitSHA }: CommonArgs): void {
	const lines = readLines(filePath);
	const lineIdx: number = findLineByCommit(lines, commitSHA);

	log("commitSHA: %s, lineIdx: %s, newLine: %s", commitSHA, lineIdx, newLine);

	lines.splice(lineIdx, 0, newLine);

	writeLines(filePath, lines);
}

export function humanOpChangeCommandOfNthCommitInto(
	newCommand: RegularRebaseCommand,
	{ commitSHA, filePath }: CommonArgs
): void {
	const lines = readLines(filePath);
	const lineIdx: number = findLineByCommit(lines, commitSHA);

	log("commitSHA: %s, lineIdx: %s, newCommand: %s", commitSHA, lineIdx, newCommand);

	const parts = lines[lineIdx].split(" ");
	parts[0] = newCommand;
	lines[lineIdx] = parts.join(" ");

	writeLines(filePath, lines);
}

export function humanOpRemoveLineOfCommit({ filePath, commitSHA }: CommonArgs): void {
	const lines: string[] = readLines(filePath);
	const idx: number = findLineByCommit(lines, commitSHA);

	/**
	 * remove (implicit "drop")
	 *
	 * TODO respect some git config setting where implicit drops
	 * are allowed or not (i think was info/warning/error)
	 */
	lines.splice(idx, 1);

	writeLines(filePath, lines);
}

export function modifyLines(filePath: string, modifier = (lines: string[]) => lines): void {
	const lines: string[] = readLines(filePath);
	const modifiedLines: string[] = modifier(lines);
	writeLines(filePath, modifiedLines);
};

export function readLines(filePath: string): string[] {
	const file = fs.readFileSync(filePath, { encoding: "utf-8" });
	const lines = file.split("\n");
	return lines;
}

export function writeLines(filePath: string, lines: string[]): void {
	fs.writeFileSync(filePath, lines.join("\n"));
}

export function findLineByCommit(lines: string[], commitSHA: string): number {
	/**
	 * TODO more advanced finding to allow for any command,
	 * not just "picK"
	 */
	return lines.findIndex((line) => line.startsWith(`pick ${commitSHA}`));
}
