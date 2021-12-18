import fs from "fs";
import assert from "assert";

import Git from "nodegit";

import { GoodCommand } from "./parse-todo-of-stacked-rebase/validator";
import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { EitherExitFinal, fail } from "./util/Exitable";

import { parseNewGoodCommands } from "./parse-todo-of-stacked-rebase/parseNewGoodCommands";

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

	const [exit, stackedRebaseCommandsNew] = parseNewGoodCommands(repo, pathToStackedRebaseTodoFile);
	if (!stackedRebaseCommandsNew) return fail(exit);

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
