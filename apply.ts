import fs from "fs";

import Git from "nodegit";

import { noop } from "./util/noop";

import {
	BranchSequencerBase, //
	branchSequencer,
	ActionInsideEachCheckedOutBranch,
	CallbackAfterDone,
} from "./branchSequencer";

export const apply: BranchSequencerBase = (args) =>
	branchSequencer({
		...args,
		actionInsideEachCheckedOutBranch: defaultApplyAction,
		// callbackAfterDone: defaultApplyCallback,
		delayMsBetweenCheckouts: 0,
	});

const defaultApplyAction: ActionInsideEachCheckedOutBranch = async ({
	repo, //
	// targetBranch,
	targetCommitSHA,
	cmd,
	isFinalCheckout,
	// execSyncInRepo,
}) => {
	const commit: Git.Commit = await Git.Commit.lookup(repo, targetCommitSHA);

	console.log("will reset because", cmd.commandOrAliasName, "to commit", commit.summary(), commit.sha());

	console.log({ isFinalCheckout });

	if (!isFinalCheckout) {
		await Git.Reset.reset(repo, commit, Git.Reset.TYPE.HARD, {});

		// if (previousTargetBranchName) {
		// execSyncInRepo(`/usr/bin/env git rebase ${previousTargetBranchName}`);
		// }
	}
};

export const getBackupPathOfPreviousStackedRebase = (pathToStackedRebaseDirInsideDotGit: string): string =>
	pathToStackedRebaseDirInsideDotGit + ".previous";

/**
 * disabled because `forcePush` also became a thing
 * and it's no longer clear what marks a stacked-rebase "done",
 *
 * thus making it hard to work with the temporary/previous directories
 * without introducing a good amount of bugs.
 *
 */
const defaultApplyCallback__disabled: CallbackAfterDone = ({
	pathToStackedRebaseDirInsideDotGit, //
}): void => {
	const backupPath: string = getBackupPathOfPreviousStackedRebase(pathToStackedRebaseDirInsideDotGit);

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
};
noop(defaultApplyCallback__disabled);
