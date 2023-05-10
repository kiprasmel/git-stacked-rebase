/* eslint-disable indent */

import assert from "assert";

import Git from "nodegit";
import { array } from "nice-comment";

import { filenames } from "../filenames";
// eslint-disable-next-line import/no-cycle
import { readRewrittenListNotAppliedOrAppliedOrError } from "../apply";

import { parseTodoOfStackedRebase } from "./parseTodoOfStackedRebase";
import {
	GoodCommand, //
	namesOfRebaseCommandsThatWillDisappearFromCommandList,
	stackedRebaseCommands,
} from "./validator";

import { log } from "../util/log";

export function parseNewGoodCommands(
	repo: Git.Repository,
	pathToStackedRebaseTodoFile: string //
): GoodCommand[] {
	const oldGoodCommands: GoodCommand[] = parseTodoOfStackedRebase(pathToStackedRebaseTodoFile);

	logGoodCmds(oldGoodCommands);

	const { combinedRewrittenListLines } = readRewrittenListNotAppliedOrAppliedOrError(repo.path());

	const newCommits: { newSHA: string; oldSHAs: string[] }[] = [];

	type OldCommit = { oldSHA: string; newSHA: string; changed: boolean };
	const oldCommits: OldCommit[] = [];

	combinedRewrittenListLines.map((line) => {
		const fromToSHA = line.split(" ");
		assert(
			fromToSHA.length === 2,
			`from and to SHAs, coming from ${filenames.rewrittenList}, are written properly (1 space total).`
		);

		const [oldSHA, newSHA] = fromToSHA;

		oldCommits.push({ oldSHA, newSHA, changed: oldSHA !== newSHA });

		const last = newCommits.length - 1;

		if (newCommits.length && newSHA === newCommits[last].newSHA) {
			/**
			 * accumulating - if multiple commits got molded into 1
			 */
			newCommits[last].oldSHAs.push(oldSHA);
		} else {
			/**
			 * initializing a new commit
			 */
			newCommits.push({
				newSHA,
				oldSHAs: [oldSHA],
			});
		}

		//
	});

	log({ newCommits: newCommits.map((c) => c.newSHA + ": " + array(c.oldSHAs)) });
	log({ oldCommits });

	/**
	 * match oldCommits & goodCommands
	 */
	const goodNewCommands: GoodCommand[] = [];

	goodNewCommands.push(oldGoodCommands[0]);

	let lastNewCommit: OldCommit | null = null;

	/**
	 * TODO FIXME
	 *
	 * we're going thru oldCommits and incrementing the `i`,
	 * even though we jump thru and keep staying at the same `goodCommandMinIndex`.
	 *
	 * the oldCommits are from the rewrittenList,
	 * meaning they only begin from where the first rewrite was done
	 * (reword/edit/etc),
	 *
	 * so iterating thru them to generate a new list of good commands
	 * ofc is broken.
	 *
	 * instead we need to go thru the old __commands__,
	 * whom come from the old git-rebase-todo file (of stacked rebase),
	 * and use the oldCommits/newCommits to re-generate the rebase todo,
	 * but now adjusted to the commits that have been rewritten.
	 *
	 */
	let goodCommandMinIndex = 1;
	for (let i = 0; i < oldCommits.length; i++) {
		const oldCommit: OldCommit = oldCommits[i];

		const oldCommandAtIdx: GoodCommand = oldGoodCommands[goodCommandMinIndex];

		if (namesOfRebaseCommandsThatWillDisappearFromCommandList.includes(oldCommandAtIdx.commandName)) {
			goodCommandMinIndex++; // the command should disappear,
			i--; // but the commit should not be lost.

			continue;
		}

		if (oldCommandAtIdx.commandName in stackedRebaseCommands) {
			goodNewCommands.push({
				...oldCommandAtIdx,
				commitSHAThatBranchPointsTo: (lastNewCommit as OldCommit | null)?.newSHA ?? null, // TODO TS
			} as any); // TODO TS
			goodCommandMinIndex++;
		}

		const goodOldCommand = oldGoodCommands.find((cmd) => cmd.targets?.[0] === oldCommit.oldSHA);

		if (!goodOldCommand) {
			throw new Error("TODO: goodCommandOld not found");
		}

		const update = () => {
			if (goodOldCommand.commandName in stackedRebaseCommands) {
				// do not modify
				/** TODO FIXME CLEANUP: this actually never happens: (add `assert(false)`) */
				goodNewCommands.push(goodOldCommand);
				// goodCommandMinIndex++;
			} else {
				// goodNewCommands.push({ ...goodOldCommand, targets: [oldCommit.newSHA] /** TODO VERIFY */ });
				lastNewCommit = oldCommit;
				goodNewCommands.push({ ...goodOldCommand, targets: [oldCommit.newSHA] /** TODO VERIFY */ });
				goodCommandMinIndex++;
			}
		};

		/**
		 * TODO `lineNumber` -- shouldn't it be `nthCommand`?
		 * need to experiment w/ e.g. "break", and comments.
		 */
		if (goodOldCommand.lineNumber < goodCommandMinIndex) {
			// TODO VERIFY
			const msg = `goodCommandOld.index (${goodOldCommand.lineNumber}) < goodCommandMinIndex (${goodCommandMinIndex}), continue'ing.`;
			log(msg); // WARN

			// goodCommandMinIndex++;

			continue;
		} else if (goodOldCommand.lineNumber === goodCommandMinIndex) {
			// perfect?
			// TODO VERIFY
			log(`index match`);

			update();
		} else {
			// jump?
			// TODO VERIFY
			log(`jump, continue'ing`); // WARN

			// update(); // TODO VERIFY
			continue;
		}

		//
	}

	goodNewCommands.push(oldGoodCommands[oldGoodCommands.length - 1]);

	log({
		len: oldGoodCommands.length,
		goodCommands: oldGoodCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
	});

	log({
		len: goodNewCommands.length,
		goodNewCommands: goodNewCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
	});

	const stackedRebaseCommandsOld = oldGoodCommands.filter((cmd) => cmd.commandName in stackedRebaseCommands);
	const stackedRebaseCommandsNew: GoodCommand[] = goodNewCommands
		.map((cmd, i) =>
			cmd.commandName in stackedRebaseCommands
				? {
						...cmd,
						commitSHAThatBranchPointsTo: i > 0 ? goodNewCommands[i - 1].targets?.[0] ?? null : null,
				  }
				: false
		)
		.filter((cmd) => !!cmd) as GoodCommand[]; // TODO TS should infer automatically

	log({
		["stackedRebaseCommandsOld.length"]: stackedRebaseCommandsOld.length,
		["stackedRebaseCommandsNew.length"]: stackedRebaseCommandsNew.length,
	});

	const oldCommandCount: number = stackedRebaseCommandsOld.length;
	const newCommandCount: number = stackedRebaseCommandsNew.length;

	log({
		stackedRebaseCommandsOld,
		stackedRebaseCommandsNew,
	})

	assert.equal(oldCommandCount, newCommandCount);

	return stackedRebaseCommandsNew;
}

const logGoodCmds = (goodCommands: GoodCommand[]): void => {
	log({
		goodCommands: goodCommands.map((c) => ({
			...c,
			targets: c.targets?.length === 1 ? c.targets[0] : array(c.targets ?? []),
		})),
	});

	log({
		goodCommands: goodCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
	});
};
