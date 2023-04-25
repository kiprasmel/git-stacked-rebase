import fs from "fs";
import assert from "assert";
import os from "os";

import Git from "nodegit";

import { CommitAndBranchBoundary, getWantedCommitsWithBranchBoundariesOurCustomImpl, removeLocalRegex, removeRemoteRegex } from "./git-stacked-rebase";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { Termination } from "./util/error";
import { assertNever } from "./util/assertNever";
import { logAlways } from "./util/log";

import { parseNewGoodCommands } from "./parse-todo-of-stacked-rebase/parseNewGoodCommands";
import { GoodCommand, GoodCommandStacked } from "./parse-todo-of-stacked-rebase/validator";

export type BranchRefs = {
	initialBranch: Git.Reference;
	currentBranch: Git.Reference;
};

export type GetBranchesCtx = BranchRefs & {
	pathToStackedRebaseDirInsideDotGit: string;
	rootLevelCommandName: string;
	repo: Git.Repository;
	pathToStackedRebaseTodoFile: string;
};

export type SimpleBranchAndCommit = {
	commitSHA: string | null;
	branchEndFullName: string[];
	// branchExistsYet: boolean; // TODO
};

export type GetBoundariesInclInitial = (
	ctx: GetBranchesCtx //
) => SimpleBranchAndCommit[] | Promise<SimpleBranchAndCommit[]>;

export const isStackedRebaseInProgress = ({
	pathToStackedRebaseDirInsideDotGit,
}: {
	pathToStackedRebaseDirInsideDotGit: string;
}): boolean => fs.existsSync(pathToStackedRebaseDirInsideDotGit);

export const getBoundariesInclInitialByParsingNotYetAppliedState: GetBoundariesInclInitial = ({
	pathToStackedRebaseDirInsideDotGit, //
	rootLevelCommandName,
	repo,
	pathToStackedRebaseTodoFile,
}) => {
	/**
	 * TODO REMOVE / modify this logic (see next comment)
	 */
	if (!isStackedRebaseInProgress({ pathToStackedRebaseDirInsideDotGit })) {
		throw new Termination(`\n\nno stacked-rebase in progress? (nothing to ${rootLevelCommandName})\n\n`);
	}
	// const hasPostRewriteHookInstalledWithLatestVersion = false;

	/**
	 *
	 * this is only needed to get the branch names.
	 *
	 * we should instead have this as a function in the options,
	 * we should provide the default value,
	 * but allow the higher level command to overwrite it.
	 *
	 * use case differences:
	 *
	 * a) apply:
	 *
	 * needs (always or no?) to parse the new good commands
	 *
	 * b) push:
	 *
	 * since is only allowed after apply has been done,
	 * it doesn't actually care nor need to parse the new good commands,
	 * and instead can be done by simply going thru the branches
	 * that you would normally do with `getWantedCommitsWithBranchBoundaries`.
	 *
	 * and so it can be used even if the user has never previously used stacked rebase!
	 * all is needed is the `initialBranch` and the current commit,
	 * so that we find all the previous branches up until `initialBranch`
	 * and just push them!
	 *
	 * and this is safe because again, if there's something that needs to be applied,
	 * then before you can push, you'll need to apply first.
	 *
	 * otherwise, you can push w/o any need of apply,
	 * or setting up the intial rebase todo, or whatever else,
	 * because it's not needed!
	 *
	 * ---
	 *
	 * this is also good because we become less stateful / need less state
	 * to function properly.
	 *
	 * it very well could get rid of some bugs / impossible states
	 * that we'd sometimes end up in.
	 * (and no longer need to manually rm -rf .git/stacked-rebase either)
	 *
	 */
	const stackedRebaseCommandsNew: GoodCommand[] = parseNewGoodCommands(repo, pathToStackedRebaseTodoFile);

	for (const cmd of stackedRebaseCommandsNew) {
		assert(cmd.rebaseKind === "stacked");
		assert(cmd.targets?.length);
	}

	return (stackedRebaseCommandsNew //
		.filter((cmd) => cmd.rebaseKind === "stacked") as GoodCommandStacked[]) //
		.map(
			(cmd): SimpleBranchAndCommit => ({
				commitSHA: cmd.commitSHAThatBranchPointsTo,
				branchEndFullName: [cmd.targets![0]],
			})
		);
};

export const getBoundariesInclInitialWithSipleBranchTraversal: GetBoundariesInclInitial = (argsBase) =>
	getWantedCommitsWithBranchBoundariesOurCustomImpl(
		argsBase.repo, //
		argsBase.initialBranch,
		argsBase.currentBranch
	).then((boundaries) => convertBoundaryToSimpleBranchAndCommit(boundaries));

export function convertBoundaryToSimpleBranchAndCommit(boundaries: CommitAndBranchBoundary[]): SimpleBranchAndCommit[] {
		return boundaries
			.filter((b) => !!b.branchEnd?.length)
			.map(
				(boundary): SimpleBranchAndCommit => ({
					branchEndFullName: boundary.branchEnd!.map((x) => x.name()), // TS ok because of the filter
					commitSHA: boundary.commit.sha(),
				})
			)
}

/**
 * not sure if i'm a fan of this indirection tbh..
 */
export enum BehaviorOfGetBranchBoundaries {
	/**
	 * the default one.
	 */
	"parse-from-not-yet-applied-state",
	/**
	 * originally used by `--push` - since it wouldn't be allowed to run
	 * before `--apply` was used,
	 * having to sync from applied state was more confusion & limiting.
	 *
	 * further, we later got rid of the state after `--apply`ing,
	 * so this became the only option anyway.
	 */
	"ignore-unapplied-state-and-use-simple-branch-traversal",
	/**
	 * this is the adaptive of the other 2.
	 * originally intended for `branchSequencerExec` (`--exec`) -
	 * we don't know what's coming from the user,
	 * so we cannot make any assumptions.
	 *
	 * instead, we simply check if a stacked rebase (our) is in progress,
	 * if so - we use the 1st option (because we have to),
	 * otherwise - the 2nd option (because we have to, too!).
	 */
	"if-stacked-rebase-in-progress-then-parse-not-applied-state-otherwise-simple-branch-traverse",
}
export const defaultGetBranchBoundariesBehavior =
	BehaviorOfGetBranchBoundaries[
		"if-stacked-rebase-in-progress-then-parse-not-applied-state-otherwise-simple-branch-traverse"
	];

export const pickBoundaryParser = ({
	behaviorOfGetBranchBoundaries,
	pathToStackedRebaseDirInsideDotGit,
}: {
	/**
	 * can provide one of the predefined behaviors,
	 * whom will decide which parser to pick,
	 *
	 * or can provide a custom parser function.
	 */
	behaviorOfGetBranchBoundaries: BehaviorOfGetBranchBoundaries | GetBoundariesInclInitial;
	pathToStackedRebaseDirInsideDotGit: string;
}): GetBoundariesInclInitial => {
	if (typeof behaviorOfGetBranchBoundaries === "function") {
		/**
		 * custom fn
		 */
		return behaviorOfGetBranchBoundaries;
	} else if (behaviorOfGetBranchBoundaries === BehaviorOfGetBranchBoundaries["parse-from-not-yet-applied-state"]) {
		return getBoundariesInclInitialByParsingNotYetAppliedState;
	} else if (
		behaviorOfGetBranchBoundaries ===
		BehaviorOfGetBranchBoundaries["ignore-unapplied-state-and-use-simple-branch-traversal"]
	) {
		return getBoundariesInclInitialWithSipleBranchTraversal;
	} else if (
		behaviorOfGetBranchBoundaries ===
		BehaviorOfGetBranchBoundaries[
			"if-stacked-rebase-in-progress-then-parse-not-applied-state-otherwise-simple-branch-traverse"
		]
	) {
		if (isStackedRebaseInProgress({ pathToStackedRebaseDirInsideDotGit })) {
			return getBoundariesInclInitialByParsingNotYetAppliedState;
		} else {
			return getBoundariesInclInitialWithSipleBranchTraversal;
		}
	} else {
		assertNever(behaviorOfGetBranchBoundaries);
	}
};

/**
 *
 */

export type ActionInsideEachCheckedOutBranchCtx = {
	repo: Git.Repository; //
	gitCmd: string;
	targetBranch: string;
	targetCommitSHA: string;
	isLatestBranch: boolean;
	execSyncInRepo: ReturnType<typeof createExecSyncInRepo>;
	
	collectError: (e: unknown) => void;
};
export type ActionInsideEachCheckedOutBranch = (ctx: ActionInsideEachCheckedOutBranchCtx) => void | Promise<void>;

export type BranchSequencerArgsBase = BranchRefs & {
	pathToStackedRebaseDirInsideDotGit: string; //
	// goodCommands: GoodCommand[];
	pathToStackedRebaseTodoFile: string;
	repo: Git.Repository;
	rootLevelCommandName: string;
	gitCmd: string;
};

export type BranchSequencerArgs = BranchSequencerArgsBase & {
	// callbackBeforeBegin?: CallbackAfterDone; // TODO
	actionInsideEachCheckedOutBranch: ActionInsideEachCheckedOutBranch;
	delayMsBetweenCheckouts?: number;
	behaviorOfGetBranchBoundaries?: Parameters<typeof pickBoundaryParser>[0]["behaviorOfGetBranchBoundaries"];

	/**
	 * normally, you checkout to the 1st partial branch in the stack,
	 * then the 2nd, etc, up until you reach the latest branch.
	 *
	 * use `reverseCheckoutOrder` to do the opposite.
	 *
	 */
	reverseCheckoutOrder: boolean;
};

export type BranchSequencerBase = (args: BranchSequencerArgsBase) => Promise<void>;
export type BranchSequencer = (args: BranchSequencerArgs) => Promise<void>;

export const branchSequencer: BranchSequencer = async ({
	pathToStackedRebaseDirInsideDotGit, //
	pathToStackedRebaseTodoFile,
	repo,
	rootLevelCommandName,
	delayMsBetweenCheckouts = 0,
	// callbackBeforeBegin,
	actionInsideEachCheckedOutBranch,
	gitCmd,
	//
	behaviorOfGetBranchBoundaries = defaultGetBranchBoundariesBehavior,
	initialBranch,
	currentBranch,
	//
	reverseCheckoutOrder = false,
}) => {
	const execSyncInRepo = createExecSyncInRepo(repo);

	const getBoundariesInclInitial: GetBoundariesInclInitial = pickBoundaryParser({
		behaviorOfGetBranchBoundaries,
		pathToStackedRebaseDirInsideDotGit,
	});

	const branchesAndCommits: SimpleBranchAndCommit[] = (
		await getBoundariesInclInitial({
			pathToStackedRebaseDirInsideDotGit,
			pathToStackedRebaseTodoFile,
			repo,
			rootLevelCommandName,
			initialBranch,
			currentBranch,
		})
	).map(trimRefNamesOfBoundary);

	/**
	 * remove the initial branch
	 */
	branchesAndCommits.shift();

	const originalBoundariesLength: number = branchesAndCommits.length;

	if (reverseCheckoutOrder) {
		branchesAndCommits.reverse();
	}

	const switchBackToLatestBranch = (msgCb?: (latestBranch: string) => string) => {
		const latestBranch: string = currentBranch.shorthand();

		if (msgCb && msgCb instanceof Function) {
			process.stdout.write(msgCb(latestBranch));
		}

		execSyncInRepo(`${gitCmd} checkout ${latestBranch}`);
	};

	/**
	 * if aborted, switch back to latest branch.
	 */
	function handleSigint() {
		switchBackToLatestBranch((latestBranch) => `\ncaught SIGINT, switching back to latest branch '${latestBranch}'\n`);
		process.exit(128 + os.constants.signals.SIGINT);
	}
	function handleSigterm() {
		switchBackToLatestBranch((latestBranch) => `\ncaught SIGTERM, switching back to latest branch '${latestBranch}'\n`);
		process.exit(128 + os.constants.signals.SIGTERM);
	}

	const collectedErrors: unknown[] = [];

	/**
	 * node process may exit because of SIGINT/SIGTERM,
	 * but before it can - an `UnhandledPromiseRejectionWarning` can occur,
	 * which prints an ugly warning, and we don't want that,
	 * since it most oftenly occurs only because of the SIGTERM (Ctrl-C),
	 * which e.g. in forcePush interrupts the executed git child process.
	 *
	 * in such a case, we don't care about the warning,
	 * and want to exit calmly.
	 * 
	 * thus, we collect the errors, and only throw them
	 * after the performing the action on all branches.
	 * obviously, we don't throw if the node process already exited.
	 */
	function collectError(e: unknown) {
		collectedErrors.push(e);
	}

	/** add listeners */
	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	return checkout(branchesAndCommits).finally(() => {
		/** remove listeners */
		process.removeListener("SIGINT", handleSigint);
		process.removeListener("SIGTERM", handleSigterm);

		if (collectedErrors.length) {
			console.error(collectedErrors);

			const msg = `encountered ${collectedErrors.length} errors, aborting.`;
			throw new Error(msg);
		}
	});

	async function checkout(boundaries: SimpleBranchAndCommit[]): Promise<void> {
		if (!boundaries.length) {
			/** done */
			switchBackToLatestBranch();
			return;
		}

		logAlways("\ncheckout", boundaries.length, reverseCheckoutOrder ? "(reversed)" : "");

		const goNext = () =>
			new Promise<void>((r) => {
				setTimeout(() => {
					checkout(boundaries.slice(1)).then(() => r());
				}, delayMsBetweenCheckouts);
			});

		const boundary = boundaries[0];
		const targetBranch = boundary.branchEndFullName;
		const targetCommitSHA: string | null = boundary.commitSHA;

		if (!targetCommitSHA) {
			return goNext();
		}

		const isLatestBranch: boolean = reverseCheckoutOrder
			? boundaries.length === originalBoundariesLength
			: boundaries.length === 1;

		for (const target of targetBranch) {
			/**
			 * https://libgit2.org/libgit2/#HEAD/group/checkout/git_checkout_head
			 */
			// await Git.Checkout.tree(repo, targetBranch as any); // TODO TS FIXME
			execSyncInRepo(`${gitCmd} checkout ${target}`); // f this

			await actionInsideEachCheckedOutBranch({
				repo, //
				gitCmd,
				targetBranch: target,
				targetCommitSHA,
				isLatestBranch,
				execSyncInRepo,
				collectError,
			});
		}

		return goNext();
	}
};

export function trimRefNamesOfBoundary(boundary: SimpleBranchAndCommit) {
	boundary.branchEndFullName = boundary.branchEndFullName.map((x) => x.replace(removeLocalRegex, ""));
	assert(boundary.branchEndFullName);

	/**
	 * if we only have the remote branch, but it's not checked out locally,
	 * we'd end up in a detached state, and things would break.
	 *
	 * thus, we checkout the branch locally if it's not.
	 */
	if (boundary.branchEndFullName.some((x) => x.startsWith("refs/remotes/"))) {
		boundary.branchEndFullName = boundary.branchEndFullName.map((x) => x.replace(removeRemoteRegex, ""));
	}

	return boundary;
}
