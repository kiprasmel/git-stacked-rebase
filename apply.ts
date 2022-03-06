import fs from "fs";
import path from "path";

import Git from "nodegit";

import { createQuestion } from "./util/createQuestion";
import { noop } from "./util/noop";

import { filenames } from "./filenames";
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
		(ret) => (markThatApplied(args.pathToStackedRebaseDirInsideDotGit), ret) //
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

export type ReturnOfApplyIfNeedsToApply = {
	markThatNeedsToApply: () => void;
} & (
	| {
			neededToApply: false;
			userAllowedToApplyAndWeApplied?: never;
	  }
	| {
			neededToApply: true;
			userAllowedToApplyAndWeApplied: false;
			// markThatNeedsToApply?: never; // TODO TS infer auto - force code owner to exit
	  }
	| {
			neededToApply: true;
			userAllowedToApplyAndWeApplied: true;
	  }
);

const getPaths = (
	pathToStackedRebaseDirInsideDotGit: string //
) =>
	({
		rewrittenListPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.rewrittenList),
		needsToApplyPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.needsToApply),
		appliedPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.applied),
	} as const);

const markThatNeedsToApply = (
	pathToStackedRebaseDirInsideDotGit: string //
): void =>
	[getPaths(pathToStackedRebaseDirInsideDotGit)].map(
		({ rewrittenListPath, needsToApplyPath, appliedPath }) => (
			fs.existsSync(rewrittenListPath)
				? fs.copyFileSync(rewrittenListPath, needsToApplyPath)
				: fs.writeFileSync(needsToApplyPath, ""),
			fs.existsSync(appliedPath) && fs.unlinkSync(appliedPath),
			void 0
		)
	)[0];

export const markThatApplied = (pathToStackedRebaseDirInsideDotGit: string): void =>
	[getPaths(pathToStackedRebaseDirInsideDotGit)].map(
		({ rewrittenListPath, needsToApplyPath, appliedPath }) => (
			fs.existsSync(needsToApplyPath) && fs.unlinkSync(needsToApplyPath), //
			fs.copyFileSync(rewrittenListPath, appliedPath),
			void 0
		)
	)[0];

const doesNeedToApply = (pathToStackedRebaseDirInsideDotGit: string): boolean => {
	const { rewrittenListPath, needsToApplyPath, appliedPath } = getPaths(pathToStackedRebaseDirInsideDotGit);

	const needsToApplyPart1: boolean = fs.existsSync(needsToApplyPath);
	if (needsToApplyPart1) {
		return true;
	}

	const needsToApplyPart2: boolean = fs.existsSync(appliedPath)
		? /**
		   * check if has been applied, but that apply is outdated
		   */
		  !fs.readFileSync(appliedPath).equals(fs.readFileSync(rewrittenListPath))
		: false;

	return needsToApplyPart2;
};

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
	const needsToApply: boolean = doesNeedToApply(pathToStackedRebaseDirInsideDotGit);
	const _markThatNeedsToApply = (): void => markThatNeedsToApply(pathToStackedRebaseDirInsideDotGit);

	if (!needsToApply) {
		return {
			neededToApply: false,
			markThatNeedsToApply: _markThatNeedsToApply,
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
					userAllowedToApplyAndWeApplied: false,
					markThatNeedsToApply: _markThatNeedsToApply,
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
	}

	return {
		neededToApply: true,
		userAllowedToApplyAndWeApplied: true, //
		markThatNeedsToApply: _markThatNeedsToApply,
	};
}
