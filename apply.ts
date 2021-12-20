import fs from "fs";
import path from "path";

import Git from "nodegit";

import { createQuestion } from "./util/createQuestion";
import { noop } from "./util/noop";

import { configKeys } from "./configKeys";
import {
	BranchSequencerBase, //
	branchSequencer,
	ActionInsideEachCheckedOutBranch,
	CallbackAfterDone,
	BranchSequencerArgsBase,
} from "./branchSequencer";

export const apply: BranchSequencerBase = (args) =>
	branchSequencer({
		...args,
		actionInsideEachCheckedOutBranch: defaultApplyAction,
		// callbackAfterDone: defaultApplyCallback,
		delayMsBetweenCheckouts: 0,
	}).then(
		(ret) => (unmarkThatNeedsToApply(args.pathToStackedRebaseDirInsideDotGit), ret) //
	);

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

export type ReturnOfApplyIfNeedsToApply =
	| {
			neededToApply: false;
			userAllowedToApply?: never;
			markThatNeedsToApply: () => void;
	  }
	| {
			neededToApply: true;
			userAllowedToApply: false;
			// markThatNeedsToApply?: never; // TODO TS infer auto - force code owner to exit
			markThatNeedsToApply: () => void;
	  }
	| {
			neededToApply: true;
			userAllowedToApply: true;
			markThatNeedsToApply: () => void;
	  };

const filenameOfNeedsToApply = "needs-to-apply" as const;

const getPathOfFilenameOfNeedsToApply = (pathToStackedRebaseDirInsideDotGit: string): string =>
	path.join(pathToStackedRebaseDirInsideDotGit, filenameOfNeedsToApply);

export const unmarkThatNeedsToApply = (
	pathToStackedRebaseDirInsideDotGit: string,
	mark = getPathOfFilenameOfNeedsToApply(pathToStackedRebaseDirInsideDotGit)
): void => (fs.existsSync(mark) ? fs.unlinkSync(mark) : void 0);

export async function applyIfNeedsToApply({
	repo,
	pathToStackedRebaseTodoFile,
	pathToStackedRebaseDirInsideDotGit, //
	autoApplyIfNeeded,
	config,
	...rest
}: BranchSequencerArgsBase & {
	autoApplyIfNeeded: boolean; //
	config: Git.Config;
}): Promise<ReturnOfApplyIfNeedsToApply> {
	/**
	 * currently we're not saving the branch names
	 * & where they point to etc.,
	 * so doing rebase after rebase without --apply
	 * will break the workflow after the 1st one.
	 *
	 * thus, until we have a more sophisticated solution,
	 * automatically --apply'ing (when needed) should do just fine.
	 *
	 */
	const pathToFileIndicatingThatNeedsToApply = getPathOfFilenameOfNeedsToApply(pathToStackedRebaseDirInsideDotGit);
	const needsToApply: boolean = fs.existsSync(pathToFileIndicatingThatNeedsToApply);

	const markThatNeedsToApply = (): void => fs.writeFileSync(pathToFileIndicatingThatNeedsToApply, "");

	if (!needsToApply) {
		return {
			neededToApply: false,
			markThatNeedsToApply,
		};
	}

	if (needsToApply) {
		if (!autoApplyIfNeeded) {
			const question = createQuestion();

			const answerRaw: string = await question("\nneed to --apply before continuing. proceed? [Y/n/(a)lways] ");
			console.log({ answerRaw });

			const answer: string = answerRaw.trim().toLowerCase();

			const userAllowedToApply: boolean = ["y", "yes", ""].includes(answer);
			console.log({ userAllowedToApply });

			const userAllowedToApplyAlways: boolean = ["a", "always"].includes(answer);

			if (!userAllowedToApply && !userAllowedToApplyAlways) {
				return {
					neededToApply: true,
					userAllowedToApply: false,
					markThatNeedsToApply,
				};
			}

			if (userAllowedToApplyAlways) {
				await config.setBool(configKeys.autoApplyIfNeeded, 1);
			}
		}

		await apply({
			repo,
			pathToStackedRebaseTodoFile,
			pathToStackedRebaseDirInsideDotGit, //
			...rest,
		});

		unmarkThatNeedsToApply(pathToStackedRebaseDirInsideDotGit);
	}

	return {
		neededToApply: true,
		userAllowedToApply: true, //
		markThatNeedsToApply,
	};
}
