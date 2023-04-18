import fs from "fs";
import path from "path";

import Git from "nodegit";
import { combineRewrittenLists } from "./git-reconcile-rewritten-list/combineRewrittenLists";

import { AskQuestion, question, Questions } from "./util/createQuestion";
import { isDirEmptySync } from "./util/fs";
import { Termination } from "./util/error";

import { filenames } from "./filenames";
import { configKeys } from "./config";
// eslint-disable-next-line import/no-cycle
import {
	BranchSequencerBase, //
	branchSequencer,
	ActionInsideEachCheckedOutBranch,
	BranchSequencerArgsBase,
	BehaviorOfGetBranchBoundaries,
} from "./branchSequencer";

export const apply: BranchSequencerBase = (args) =>
	branchSequencer({
		...args,
		actionInsideEachCheckedOutBranch: defaultApplyAction,
		// callbackAfterDone: defaultApplyCallback,
		delayMsBetweenCheckouts: 0,
		behaviorOfGetBranchBoundaries: BehaviorOfGetBranchBoundaries["parse-from-not-yet-applied-state"],
		reverseCheckoutOrder: false,
	}).then(
		(ret) => (markThatApplied(args.pathToStackedRebaseDirInsideDotGit), ret) //
	);

const defaultApplyAction: ActionInsideEachCheckedOutBranch = async ({
	repo, //
	gitCmd,
	// targetBranch,
	targetCommitSHA,
	isLatestBranch,
	execSyncInRepo,
}) => {
	const commit: Git.Commit = await Git.Commit.lookup(repo, targetCommitSHA);

	console.log("will reset to commit", commit.sha(), "(" + commit.summary() + ")");

	console.log({ isLatestBranch });

	if (!isLatestBranch) {
		/**
		 * we're not using libgit's `Git.Reset.reset` here, because even after updating
		 * to the latest version of nodegit (& they to libgit),
		 * it still chokes when a user has specified an option `merge.conflictStyle` as `zdiff3`
		 * (a newly added one in git, but it's been added like 4 months ago)
		 */
		// await Git.Reset.reset(repo, commit, Git.Reset.TYPE.HARD, {});
		execSyncInRepo(`${gitCmd} reset --hard ${commit.sha()}`);

		// if (previousTargetBranchName) {
		// execSyncInRepo(`/usr/bin/env git rebase ${previousTargetBranchName}`);
		// }
	}
};

export const getBackupPathOfPreviousStackedRebase = (pathToStackedRebaseDirInsideDotGit: string): string =>
	pathToStackedRebaseDirInsideDotGit + ".previous";

export async function applyIfNeedsToApply({
	repo,
	pathToStackedRebaseTodoFile,
	pathToStackedRebaseDirInsideDotGit, //
	autoApplyIfNeeded,
	isMandatoryIfMarkedAsNeeded,
	config,
	askQuestion = question,
	...rest
}: BranchSequencerArgsBase & {
	/**
	 * i.e., sometimes a) we need the `--apply` to go thru,
	 * and sometimes b) it's "resumable" on the next run,
	 * i.e. we'd prefer to apply right now,
	 * but it's fine if user does not apply now,
	 * because `--apply` is resumable[1],
	 * and on the next run of stacked rebase, user will be forced to apply anyway.
	 *
	 * [1] resumable, unless user runs into some edge case where it no longer is.
	 * TODO: work out when this happens & handle better.
	 */
	isMandatoryIfMarkedAsNeeded: boolean;

	autoApplyIfNeeded: boolean; //
	config: Git.Config;
	askQuestion: AskQuestion;
}): Promise<void> {
	const needsToApply: boolean = doesNeedToApply(pathToStackedRebaseDirInsideDotGit);
	if (!needsToApply) {
		return;
	}

	if (isMandatoryIfMarkedAsNeeded) {
		/**
		 * is marked as needed to apply,
		 * and is mandatory -- try to get a confirmation that it is ok to apply.
		 */
		const userAllowedToApply = autoApplyIfNeeded || (await askIfCanApply(config, askQuestion));

		if (!userAllowedToApply) {
			const msg = "\ncannot continue without mandatory --apply. Exiting.\n";
			throw new Termination(msg);
		} else {
			await apply({
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				...rest,
			});

			return;
		}
	} else {
		/**
		 * is marked as needed to apply,
		 * but performing the apply is NOT mandatory.
		 *
		 * thus, do NOT ask user if should apply -- only infer from config.
		 */

		if (autoApplyIfNeeded) {
			await apply({
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				...rest,
			});

			return;
		} else {
			/**
			 * not mandatory, thus do nothing.
			 */
		}
	}
}

const askIfCanApply = async (config: Git.Config, askQuestion: AskQuestion = question): Promise<boolean> => {
	const answer = await askQuestion(
		Questions.need_to_apply_before_continuing, //
		{ cb: (ans) => ans.trim().toLowerCase() }
	);

	const userAllowedToApply: boolean = ["y", "yes", ""].includes(answer);
	const userAllowedToApplyAlways: boolean = ["a", "always"].includes(answer);

	if (userAllowedToApplyAlways) {
		await config.setBool(configKeys.autoApplyIfNeeded, 1);
	}

	const canApply = userAllowedToApply || userAllowedToApplyAlways;

	return canApply;
};

const getPaths = (
	pathToStackedRebaseDirInsideDotGit: string //
) =>
	({
		rewrittenListPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.rewrittenList),
		needsToApplyPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.needsToApply),
		appliedPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.applied),
		gitRebaseTodoPath: path.join(pathToStackedRebaseDirInsideDotGit, filenames.gitRebaseTodo),
	} as const);

export const markThatNeedsToApply = (
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

export const isMarkedThatNeedsToApply = (pathToStackedRebaseDirInsideDotGit: string): boolean => {
	const pathToMark: string = getPaths(pathToStackedRebaseDirInsideDotGit).needsToApplyPath;
	return fs.existsSync(pathToMark);
};

export const markThatApplied = (pathToStackedRebaseDirInsideDotGit: string): void =>
	[getPaths(pathToStackedRebaseDirInsideDotGit)].map(
		({ rewrittenListPath, needsToApplyPath, gitRebaseTodoPath }) => (
			fs.existsSync(needsToApplyPath) && fs.unlinkSync(needsToApplyPath), //
			/**
			 * need to check if the `rewrittenListPath` exists,
			 * because even if it does not, then the "apply" can still go through
			 * and "apply", by using the already .applied file, i.e. do nothing.
			 *
			 * TODO just do not run "apply" if the file doesn't exist?
			 * or is there a case where it's useful still?
			 *
			 */
			// fs.existsSync(rewrittenListPath) && fs.renameSync(rewrittenListPath, appliedPath),
			// // fs.existsSync(rewrittenListPath)
			// // 	? fs.renameSync(rewrittenListPath, appliedPath)
			// // 	: !fs.existsSync(appliedPath) &&
			// // 	  (() => {
			// // 			throw new Error("applying uselessly");
			// // 	  })(),
			fs.existsSync(rewrittenListPath) && fs.unlinkSync(rewrittenListPath),
			fs.existsSync(gitRebaseTodoPath) && fs.unlinkSync(gitRebaseTodoPath),
			isDirEmptySync(pathToStackedRebaseDirInsideDotGit) &&
				fs.rmdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true }),
			void 0
		)
	)[0];

const doesNeedToApply = (pathToStackedRebaseDirInsideDotGit: string): boolean => {
	const { rewrittenListPath, needsToApplyPath, appliedPath } = getPaths(pathToStackedRebaseDirInsideDotGit);

	if (!fs.existsSync(rewrittenListPath)) {
		/**
		 * nothing to apply
		 */
		return false;
	}

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

export function readRewrittenListNotAppliedOrAppliedOrError(repoPath: string): {
	pathOfRewrittenList: string;
	pathOfRewrittenListApplied: string;
	rewrittenListRaw: string;
	/**
	 * you probably want these:
	 */
	combinedRewrittenList: string;
	combinedRewrittenListLines: string[];
} {
	const pathOfRewrittenList: string = path.join(repoPath, "stacked-rebase", filenames.rewrittenList);
	const pathOfRewrittenListApplied: string = path.join(repoPath, "stacked-rebase", filenames.applied);

	/**
	 * not combined yet
	 */
	let rewrittenListRaw: string;
	if (fs.existsSync(pathOfRewrittenList)) {
		rewrittenListRaw = fs.readFileSync(pathOfRewrittenList, { encoding: "utf-8" });
	} else if (fs.existsSync(pathOfRewrittenListApplied)) {
		rewrittenListRaw = fs.readFileSync(pathOfRewrittenListApplied, { encoding: "utf-8" });
	} else {
		throw new Error(`rewritten-list not found neither in ${pathOfRewrittenList}, nor in ${pathOfRewrittenListApplied}`);
	}

	const { combinedRewrittenList } = combineRewrittenLists(rewrittenListRaw);

	return {
		pathOfRewrittenList,
		pathOfRewrittenListApplied,
		rewrittenListRaw,
		combinedRewrittenList,
		combinedRewrittenListLines: combinedRewrittenList.split("\n").filter((line) => !!line),
	};
}
