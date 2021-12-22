import fs from "fs";
import assert from "assert";

import Git from "nodegit";

import { filenames } from "./filenames";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { EitherExitFinal, fail } from "./util/Exitable";

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
	rewrittenListFile?: typeof filenames.rewrittenList | typeof filenames.rewrittenListApplied;
};

export type BranchSequencerBase = (args: BranchSequencerArgsBase) => Promise<EitherExitFinal>;
export type BranchSequencer = (args: BranchSequencerArgs) => Promise<EitherExitFinal>;

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
	rewrittenListFile = filenames.rewrittenList,
}) => {
	if (!fs.existsSync(pathToStackedRebaseDirInsideDotGit)) {
		return fail(`\n\nno stacked-rebase in progress? (nothing to ${rootLevelCommandName})\n\n`);
	}

	const [exit, stackedRebaseCommandsNew] = parseNewGoodCommands(repo, pathToStackedRebaseTodoFile, rewrittenListFile);
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

	const execSyncInRepo = createExecSyncInRepo(repo);

	const checkout = async (cmds: GoodCommand[]): Promise<void> => {
		console.log("\ncheckout", cmds.length);
		if (!cmds.length) {
			return;
		}

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

		const targetBranch = cmd.targets[0].replace("refs/heads/", "");
		assert(targetBranch && typeof targetBranch === "string");

		// console.log({ targetCommitSHA, target: targetBranch });

		/**
		 * meaning we're on the latest branch
		 */
		const isFinalCheckout: boolean = cmds.length === 1;

		// await Git.Checkout.tree(repo, targetBranch as any); // TODO TS FIXME
		execSyncInRepo(`git checkout ${targetBranch}`); // f this

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

	callbackAfterDone({
		pathToStackedRebaseDirInsideDotGit,
	});

	return;
};
