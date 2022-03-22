import fs from "fs";
import assert from "assert";

import Git from "nodegit";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { Termination } from "./util/error";

import { parseNewGoodCommands } from "./parse-todo-of-stacked-rebase/parseNewGoodCommands";
import { GoodCommand, GoodCommandStacked } from "./parse-todo-of-stacked-rebase/validator";

export type GetBranchesCtx = {
	pathToStackedRebaseDirInsideDotGit: string;
	rootLevelCommandName: string;
	repo: Git.Repository;
	pathToStackedRebaseTodoFile: string;
};
export type SimpleBranchAndCommit = {
	commitSHA: string | null;
	branchEndFullName: string;
	// branchExistsYet: boolean; // TODO
};
export type GetBoundariesInclInitial = (
	ctx: GetBranchesCtx //
) => SimpleBranchAndCommit[] | Promise<SimpleBranchAndCommit[]>;

const defautlGetBoundariesInclInitial: GetBoundariesInclInitial = ({
	pathToStackedRebaseDirInsideDotGit, //
	rootLevelCommandName,
	repo,
	pathToStackedRebaseTodoFile,
}) => {
	/**
	 * TODO REMOVE / modify this logic (see next comment)
	 */
	if (!fs.existsSync(pathToStackedRebaseDirInsideDotGit)) {
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
				branchEndFullName: cmd.targets![0],
			})
		);
};

/**
 *
 */

export type ActionInsideEachCheckedOutBranchCtx = {
	repo: Git.Repository; //
	targetBranch: string;
	targetCommitSHA: string;
	isFinalCheckout: boolean;
	execSyncInRepo: ReturnType<typeof createExecSyncInRepo>;
};
export type ActionInsideEachCheckedOutBranch = (ctx: ActionInsideEachCheckedOutBranchCtx) => void | Promise<void>;

export type BranchSequencerArgsBase = {
	pathToStackedRebaseDirInsideDotGit: string; //
	// goodCommands: GoodCommand[];
	pathToStackedRebaseTodoFile: string;
	repo: Git.Repository;
	rootLevelCommandName: string;
	gitCmd: string;
	//
	initialBranch: Git.Reference;
	currentBranch: Git.Reference;
};
export type BranchSequencerArgs = BranchSequencerArgsBase & {
	// callbackBeforeBegin?: CallbackAfterDone; // TODO
	actionInsideEachCheckedOutBranch: ActionInsideEachCheckedOutBranch;
	delayMsBetweenCheckouts?: number;
	/**
	 *
	 */
	getBoundariesInclInitial?: GetBoundariesInclInitial;
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
	getBoundariesInclInitial = defautlGetBoundariesInclInitial,
}) => {
	const execSyncInRepo = createExecSyncInRepo(repo);

	const branchesAndCommits: SimpleBranchAndCommit[] = await getBoundariesInclInitial({
		pathToStackedRebaseDirInsideDotGit,
		pathToStackedRebaseTodoFile,
		repo,
		rootLevelCommandName,
	});

	return checkout(branchesAndCommits.slice(1) as any); // TODO TS

	async function checkout(boundaries: SimpleBranchAndCommit[]): Promise<void> {
		if (!boundaries.length) {
			return;
		}

		console.log("\ncheckout", boundaries.length);

		const goNext = () =>
			new Promise<void>((r) => {
				setTimeout(() => {
					checkout(boundaries.slice(1)).then(() => r());
				}, delayMsBetweenCheckouts);
			});

		const boundary = boundaries[0];
		const branch = boundary.branchEndFullName;
		const targetCommitSHA: string | null = boundary.commitSHA;

		if (!targetCommitSHA) {
			return goNext();
		}

		let targetBranch = branch.replace("refs/heads/", "");
		assert(targetBranch);

		/**
		 * if we only have the remote branch, but it's not checked out locally,
		 * we'd end up in a detached state, and things would break.
		 *
		 * thus, we checkout the branch locally if it's not.
		 */
		// if (!Git.Branch.lookup(repo, targetBranch, Git.Branch.BRANCH.LOCAL)) {
		// 	execSyncInRepo();
		// }
		if (targetBranch.startsWith("refs/remotes/")) {
			/**
			 * TODO - probably should handle this "checkout remote branch locally" logic
			 * in a better place than here,
			 *
			 * especially since this is quite fragile,
			 * e.g. if multiple remotes exist & have the same branch..
			 *
			 * here's a hint that git gives in this situation (& exits w/ 1 so good that errors)
			 *
			 * ```
			 * hint: If you meant to check out a remote tracking branch on, e.g. 'origin',
			 * hint: you can do so by fully qualifying the name with the --track option:
			 * hint:
			 * hint:     git checkout --track origin/<name>
			 * hint:
			 * hint: If you'd like to always have checkouts of an ambiguous <name> prefer
			 * hint: one remote, e.g. the 'origin' remote, consider setting
			 * hint: checkout.defaultRemote=origin in your config.
			 * fatal: 'fork' matched multiple (2) remote tracking branches
			 * ```
			 *
			 * seems like we should be checking all the branches somewhere early,
			 * and either checking them out locally,
			 * or if not possible because multiple remotes, then asking them
			 * which remote to use (or individual, idk).
			 *
			 * tho, this might not always be necessary, so maybe not good
			 * to ask for something that might not be needed?
			 * or maybe it is always necessary, then yeah, should handle early.
			 *
			 * probably a good spot would be in the `branchSequencer`,
			 * just not in an individual "checkout",
			 * but rather - before any checkouts take place --
			 * by doing the pre-checking logic if branches exists
			 * before doing the checkouts.
			 *
			 */
			targetBranch = targetBranch.replace(/refs\/remotes\/[^/]+\//, "");
		}

		// console.log({ targetCommitSHA, target: targetBranch });

		/**
		 * meaning we're on the latest branch
		 */
		const isFinalCheckout: boolean = boundaries.length === 1;

		/**
		 * https://libgit2.org/libgit2/#HEAD/group/checkout/git_checkout_head
		 */
		// await Git.Checkout.tree(repo, targetBranch as any); // TODO TS FIXME
		execSyncInRepo(`${gitCmd} checkout ${targetBranch}`); // f this

		await actionInsideEachCheckedOutBranch({
			repo, //
			targetBranch,
			targetCommitSHA,
			isFinalCheckout,
			execSyncInRepo,
		});

		return goNext();
	}
};
