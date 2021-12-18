/* eslint-disable indent */

import fs from "fs";

import { EitherExit } from "../util/Exitable";
// import path from "path";

import { GoodCommand, validate } from "./validator";

export function parseTodoOfStackedRebase(
	pathToStackedRebaseTodoFile: string //
	// goodCommands: GoodCommand[]
): EitherExit<GoodCommand[]> {
	const editedRebaseTodo: string = fs.readFileSync(pathToStackedRebaseTodoFile, { encoding: "utf-8" });
	const linesOfEditedRebaseTodo: string[] = editedRebaseTodo.split("\n").filter((line) => !!line);

	console.log({ linesOfEditedRebaseTodo });

	return validate(linesOfEditedRebaseTodo);
}
