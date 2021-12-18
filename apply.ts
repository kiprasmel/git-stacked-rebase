/* eslint-disable indent */

import fs from "fs";
import path from "path";
import assert from "assert";

import Git from "nodegit";
import { array } from "nice-comment";

import { parseTodoOfStackedRebase } from "./parse-todo-of-stacked-rebase/parseTodoOfStackedRebase";
import { GoodCommand, stackedRebaseCommands } from "./parse-todo-of-stacked-rebase/validator";
import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { EitherExitFinal, fail } from "./util/Exitable";

export type ApplyArgs = {
	pathToStackedRebaseDirInsideDotGit: string; //
	// goodCommands: GoodCommand[];
	pathToStackedRebaseTodoFile: string;
	repo: Git.Repository;
};

export async function apply({
	pathToStackedRebaseDirInsideDotGit, //
	// goodCommands,
	pathToStackedRebaseTodoFile,
	repo,
}: ApplyArgs): Promise<EitherExitFinal> {
	if (!fs.existsSync(pathToStackedRebaseDirInsideDotGit)) {
		return fail("\n\nno stacked-rebase in progress? (nothing to --apply)\n\n");
	}

	const [exit, goodCommands] = parseTodoOfStackedRebase(pathToStackedRebaseTodoFile);
	if (!goodCommands) return fail(exit);

	logGoodCmds(goodCommands);

	const pathOfRewrittenList: string = path.join(repo.workdir(), ".git", "stacked-rebase", "rewritten-list");
	const rewrittenList: string = fs.readFileSync(pathOfRewrittenList, { encoding: "utf-8" });
	const rewrittenListLines: string[] = rewrittenList.split("\n").filter((line) => !!line);

	console.log({ rewrittenListLines });

	const newCommits: { newSHA: string; oldSHAs: string[] }[] = [];

	type OldCommit = { oldSHA: string; newSHA: string; changed: boolean };
	const oldCommits: OldCommit[] = [];

	rewrittenListLines.map((line) => {
		const fromToSHA = line.split(" ");
		assert(
			fromToSHA.length === 2,
			"from and to SHAs, coming from rewritten-list, are written properly (1 space total)."
		);

		const [oldSHA, newSHA] = fromToSHA;

		oldCommits.push({ oldSHA, newSHA, changed: oldSHA !== newSHA });

		const last = newCommits.length - 1;

		if (newCommits.length && newSHA === newCommits[last].newSHA) {
			newCommits[last].oldSHAs.push(oldSHA);
		} else {
			newCommits.push({
				newSHA,
				oldSHAs: [oldSHA],
			});
		}

		//
	});

	console.log({ newCommits: newCommits.map((c) => c.newSHA + ": " + array(c.oldSHAs)) });
	console.log({ oldCommits });

	/**
	 * match oldCommits & goodCommands
	 */
	const goodNewCommands: GoodCommand[] = [];

	goodNewCommands.push(goodCommands[0]);

	let lastNewCommit: OldCommit | null = null;

	let goodCommandMinIndex = 1;
	for (let i = 0; i < oldCommits.length; i++) {
		const oldCommit: OldCommit = oldCommits[i];

		const oldCommandAtIdx: GoodCommand = goodCommands[goodCommandMinIndex];

		if (oldCommandAtIdx.commandName in stackedRebaseCommands) {
			goodNewCommands.push({
				...oldCommandAtIdx,
				commitSHAThatBranchPointsTo: (lastNewCommit as OldCommit | null)?.newSHA ?? null, // TODO TS
			} as any); // TODO TS
			goodCommandMinIndex++;
		}

		const goodOldCommand = goodCommands.find((cmd) => cmd.targets?.[0] === oldCommit.oldSHA);

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

		if (goodOldCommand.index < goodCommandMinIndex) {
			// TODO VERIFY
			console.warn(
				`goodCommandOld.index (${goodOldCommand.index}) < goodCommandMinIndex (${goodCommandMinIndex}), continue'ing.`
			);

			// goodCommandMinIndex++;

			continue;
		} else if (goodOldCommand.index === goodCommandMinIndex) {
			// perfect?
			// TODO VERIFY
			console.info(`index match`);

			update();
		} else {
			// jump?
			// TODO VERIFY
			console.warn(`jump, continue'ing`);

			// update(); // TODO VERIFY
			continue;
		}

		//
	}

	goodNewCommands.push(goodCommands[goodCommands.length - 1]);

	// console.log({ goodNewCommands });
	console.log({
		len: goodCommands.length,
		goodCommands: goodCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
	});

	console.log({
		len: goodNewCommands.length,
		goodNewCommands: goodNewCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
	});

	const stackedRebaseCommandsOld = goodCommands.filter((cmd) => cmd.commandName in stackedRebaseCommands);
	const stackedRebaseCommandsNew = goodNewCommands
		.map((cmd, i) =>
			cmd.commandName in stackedRebaseCommands
				? {
						...cmd,
						commitSHAThatBranchPointsTo: i > 0 ? goodNewCommands[i - 1].targets?.[0] ?? null : null,
				  }
				: false
		)
		.filter((cmd) => !!cmd);

	assert(stackedRebaseCommandsOld.length === stackedRebaseCommandsNew.length);

	// const remotes: Git.Remote[] = await repo.getRemotes();
	// const remote: Git.Remote | undefined = remotes.find((r) =>
	// 	stackedRebaseCommandsOld.find((cmd) => cmd.targets && cmd.targets[0].includes(r.name()))
	// );

	// const diffCommands: string[] = stackedRebaseCommandsOld
	// 	.map((cmd, idx) => {
	// 		const otherCmd: GoodCommand = stackedRebaseCommandsNew[idx];
	// 		assert(cmd.commandName === otherCmd.commandName);
	// 		assert(cmd.targets?.length);
	// 		assert(otherCmd.targets?.length);
	// 		assert(cmd.targets.every((t) => otherCmd.targets?.every((otherT) => t === otherT)));

	// 		const trim = (str: string): string => str.replace("refs/heads/", "").replace("refs/remotes/", "");

	// 		return !remote || idx === 0 // || idx === stackedRebaseCommandsOld.length - 1
	// 			? ""
	// 			: `git -c core.pager='' diff -u ${remote.name()}/${trim(cmd.targets[0])} ${trim(
	// 					otherCmd.targets[0]
	// 			  )}`;
	// 	})
	// 	.filter((cmd) => !!cmd);

	/**
	 * first actually reset, only then diff
	 */

	// const commitsWithBranchBoundaries: CommitAndBranchBoundary[] = (
	// 	await getWantedCommitsWithBranchBoundaries(
	// 		repo, //
	// 		initialBranch
	// 	)
	// ).reverse();

	// const previousTargetBranchName: string = stackedRebaseCommandsNew[0]
	// 	? stackedRebaseCommandsNew[0].targets?.[0] ?? ""
	// 	: "";

	const checkout = async (cmds: GoodCommand[]): Promise<void> => {
		console.log("checkout", cmds.length);
		if (!cmds.length) {
			return;
		}

		const goNext = () =>
			new Promise<void>((r) => {
				setTimeout(() => {
					checkout(cmds.slice(1)).then(() => r());
				}, 100);
			});

		const cmd = cmds[0];
		assert(cmd.rebaseKind === "stacked");

		const targetCommitSHA: string | null = cmd.commitSHAThatBranchPointsTo;

		if (!targetCommitSHA) {
			return goNext();
		}

		assert(cmd.targets?.length);

		const targetBranch = cmd.targets[0].replace("refs/heads/", "");
		assert(targetBranch && typeof targetBranch === "string");

		// console.log({ targetCommitSHA, target: targetBranch });

		const execSyncInRepo = createExecSyncInRepo(repo);

		// await Git.Checkout.tree(repo, targetBranch as any); // TODO TS FIXME
		execSyncInRepo(`git checkout ${targetBranch}`); // f this

		const commit: Git.Commit = await Git.Commit.lookup(repo, targetCommitSHA);

		console.log("will reset because", cmd.commandOrAliasName, "to commit", commit.summary(), commit.sha());

		/**
		 * meaning we're on the latest branch
		 */
		const isFinalCheckout: boolean = cmds.length === 1;

		console.log({ isFinalCheckout });

		if (!isFinalCheckout) {
			await Git.Reset.reset(repo, commit, Git.Reset.TYPE.HARD, {});

			// if (previousTargetBranchName) {
			// execSyncInRepo(`/usr/bin/env git rebase ${previousTargetBranchName}`);
			// }
		}

		return goNext();

		// for (const cmd of stackedRebaseCommandsNew) {
		// 	};
	};

	await checkout(stackedRebaseCommandsNew.slice(1) as any); // TODO TS

	const backupPath: string = pathToStackedRebaseDirInsideDotGit + ".previous";

	/**
	 * backup dir just in case, but in inactive path
	 * (so e.g --apply won't go off again accidently)
	 */
	if (fs.existsSync(backupPath)) {
		fs.rmdirSync(backupPath, { recursive: true });
	}
	fs.renameSync(pathToStackedRebaseDirInsideDotGit, backupPath);

	// diffCommands.forEach((cmd) => {
	// 	console.log({ cmd });
	// 	execSyncInRepo(cmd, { ...pipestdio(repo.workdir()) });
	// });
	//

	return;
}

const logGoodCmds = (goodCommands: GoodCommand[]): void => {
	console.log({
		goodCommands: goodCommands.map((c) => ({
			...c,
			targets: c.targets?.length === 1 ? c.targets[0] : array(c.targets ?? []),
		})),
	});

	console.log({
		goodCommands: goodCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
	});
};
