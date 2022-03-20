import fs from "fs";
import assert from "assert";

import Git from "nodegit";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { Termination } from "./util/error";

import { parseNewGoodCommands } from "./parse-todo-of-stacked-rebase/parseNewGoodCommands";
import { GoodCommand } from "./parse-todo-of-stacked-rebase/validator";

export type ActionInsideEachCheckedOutBranch = (ctx: ArgsForActionInsideEachCheckedOutBranch) => void | Promise<void>;

/**
 *
 */

export type ArgsForActionInsideEachCheckedOutBranch = {
	repo: Git.Repository; //
	targetBranch: string;
	targetCommitSHA: string;
	cmd: GoodCommand;
	isFinalCheckout: boolean;
	execSyncInRepo: ReturnType<typeof createExecSyncInRepo>;
};

/**
 *
 */

export type CtxForCallbackAfterDone = {
	pathToStackedRebaseDirInsideDotGit: string;
};

export type CallbackAfterDone = (ctx: CtxForCallbackAfterDone) => void | Promise<void>;

/**
 *
 */

export type BranchSequencerArgsBase = {
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
	callbackAfterDone?: CallbackAfterDone;
};

export type BranchSequencerBase = (args: BranchSequencerArgsBase) => Promise<void>;
export type BranchSequencer = (args: BranchSequencerArgs) => Promise<void>;

export const branchSequencer: BranchSequencer = async ({
	pathToStackedRebaseDirInsideDotGit, //
	// goodCommands,
	pathToStackedRebaseTodoFile,
	repo,
	rootLevelCommandName,
	delayMsBetweenCheckouts = 0,
	// callbackBeforeBegin,
	actionInsideEachCheckedOutBranch,
	callbackAfterDone = (): void => {},
	gitCmd,
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

	const execSyncInRepo = createExecSyncInRepo(repo);

	const checkout = async (cmds: GoodCommand[]): Promise<void> => {
		if (!cmds.length) {
			return;
		}

		console.log("\ncheckout", cmds.length);

		const goNext = () =>
			new Promise<void>((r) => {
				setTimeout(() => {
					checkout(cmds.slice(1)).then(() => r());
				}, delayMsBetweenCheckouts);
			});

		const cmd = cmds[0];

		assert(cmd.rebaseKind === "stacked");

		const targetCommitSHA: string | null = cmd.commitSHAThatBranchPointsTo;

		if (!targetCommitSHA) {
			return goNext();
		}

		assert(cmd.targets?.length);

		let targetBranch = cmd.targets[0].replace("refs/heads/", "");
		assert(targetBranch && typeof targetBranch === "string");

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
		const isFinalCheckout: boolean = cmds.length === 1;

		/**
		 * https://libgit2.org/libgit2/#HEAD/group/checkout/git_checkout_head
		 */
		// await Git.Checkout.tree(repo, targetBranch as any); // TODO TS FIXME
		execSyncInRepo(`${gitCmd} checkout ${targetBranch}`); // f this

		await actionInsideEachCheckedOutBranch({
			repo, //
			targetBranch,
			targetCommitSHA,
			cmd,
			isFinalCheckout,
			execSyncInRepo,
		});

		return goNext();

		// for (const cmd of stackedRebaseCommandsNew) {
		// 	};
	};

	await checkout(stackedRebaseCommandsNew.slice(1) as any); // TODO TS

	await callbackAfterDone({
		pathToStackedRebaseDirInsideDotGit,
	});

	return;
};
