#!/usr/bin/env ts-node-dev

/* eslint-disable indent */
/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";
import fs from "fs";
import path from "path";
import assert from "assert";
import { bullets } from "nice-comment";

/**
 * separate package (soon)
 */
import { setupPostRewriteHookFor } from "./git-reconcile-rewritten-list/postRewriteHook";

import { filenames } from "./filenames";
import { configKeys } from "./configKeys";
import { apply, applyIfNeedsToApply, markThatNeedsToApply as _markThatNeedsToApply } from "./apply";
import { forcePush } from "./forcePush";
import { BehaviorOfGetBranchBoundaries, branchSequencer } from "./branchSequencer";
import { autosquash } from "./autosquash";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { noop } from "./util/noop";
import { uniq } from "./util/uniq";
import { parseTodoOfStackedRebase } from "./parse-todo-of-stacked-rebase/parseTodoOfStackedRebase";
import { Termination } from "./util/error";
import { assertNever } from "./util/assertNever";
import { Single, Tuple } from "./util/tuple";
import { isDirEmptySync } from "./util/fs";
import {
	GoodCommand,
	GoodCommandRegular,
	GoodCommandStacked, //
	namesOfRebaseCommandsThatMakeRebaseExitToPause,
	regularRebaseCommands,
	RegularRebaseEitherCommandOrAlias,
	StackedRebaseCommand,
	StackedRebaseCommandAlias,
} from "./parse-todo-of-stacked-rebase/validator";

// console.log = () => {};

export type OptionsForGitStackedRebase = {
	gitDir: string;
	getGitConfig: (ctx: { GitConfig: typeof Git.Config; repo: Git.Repository }) => Promise<Git.Config> | Git.Config;

	/**
	 * editor name, or a function that opens the file inside some editor.
	 */
	editor: string | ((ctx: { filePath: string }) => void | Promise<void>);

	/**
	 * for executing raw git commands
	 * that aren't natively supported by `nodegit` (libgit2)
	 */
	gitCmd: string;

	viewTodoOnly: boolean;
	apply: boolean;
	continue: boolean;
	push: boolean;
	forcePush: boolean;

	branchSequencer: boolean;
	branchSequencerExec: string | false;
};

export type SomeOptionsForGitStackedRebase = Partial<OptionsForGitStackedRebase>;

export const defaultEditor = "vi" as const;
export const defaultGitCmd = "/usr/bin/env git" as const;

export const getDefaultOptions = (): OptionsForGitStackedRebase => ({
	gitDir: ".", //
	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	getGitConfig: ({ GitConfig }) => GitConfig.openDefault(),
	editor: process.env.EDITOR ?? defaultEditor,
	gitCmd: process.env.GIT_CMD ?? defaultGitCmd,
	viewTodoOnly: false,
	apply: false,
	continue: false,
	push: false,
	forcePush: false,
	branchSequencer: false,
	branchSequencerExec: false,
});

function areOptionsIncompetible(
	options: OptionsForGitStackedRebase, //
	reasons: string[] = []
): boolean {
	if (options.viewTodoOnly) {
		if (options.apply) reasons.push("--apply cannot be used together with --view-todo");
		if (options.continue) reasons.push("--continue cannot be used together with --view-todo");
		if (options.push) reasons.push("--push cannot be used together with --view-todo");
		if (options.forcePush) reasons.push("--push --force cannot be used together with --view-todo");
		if (options.branchSequencer) reasons.push("--branch-sequencer cannot be used together with --view-todo");
		if (options.branchSequencerExec)
			reasons.push("--branch-sequencer --exec cannot be used together with --view-todo");
	}

	/**
	 * TODO HANDLE ALL CASES
	 */

	return reasons.length > 0;
}

export const gitStackedRebase = async (
	nameOfInitialBranch: string,
	specifiedOptions: SomeOptionsForGitStackedRebase = {}
): Promise<void> => {
	try {
		const options: OptionsForGitStackedRebase = {
			...getDefaultOptions(), //
			...removeUndefinedProperties(specifiedOptions),
		};
		console.log({ options });

		const reasonsWhatWhyIncompatible: string[] = [];

		if (areOptionsIncompetible(options, reasonsWhatWhyIncompatible)) {
			throw new Termination(
				"\n" +
					bullets(
						"error - incompatible options:", //
						reasonsWhatWhyIncompatible,
						"  "
					) +
					"\n\n"
			);
		}

		const repo = await Git.Repository.open(options.gitDir);
		const config: Git.Config = await options.getGitConfig({ GitConfig: Git.Config, repo });

		const configValues = {
			gpgSign: !!(await config.getBool(configKeys.gpgSign).catch(() => 0)),
			autoApplyIfNeeded: !!(await config.getBool(configKeys.autoApplyIfNeeded).catch(() => 0)),
			autoSquash: !!(await config.getBool(configKeys.autoSquash).catch(() => 0)),
		} as const;

		console.log({ configValues });

		// if (process.env.QUIT) return;

		const execSyncInRepo = createExecSyncInRepo(repo);

		const dotGitDirPath: string = repo.path();

		const pathToRegularRebaseDirInsideDotGit: string = path.join(dotGitDirPath, "rebase-merge");
		const pathToRegularRebaseTodoFile = path.join(pathToRegularRebaseDirInsideDotGit, filenames.gitRebaseTodo);

		const createPathForStackedRebase = (withName: string): string => path.join(dotGitDirPath, withName); // "stacked-rebase"

		const __default__pathToStackedRebaseDirInsideDotGit: string = createPathForStackedRebase("stacked-rebase");
		const __default__pathToStackedRebaseTodoFile = path.join(
			__default__pathToStackedRebaseDirInsideDotGit,
			filenames.gitRebaseTodo
		);

		let parsed: {
			pathToStackedRebaseDirInsideDotGit: string;
			pathToStackedRebaseTodoFile: string;
		};

		if (options.viewTodoOnly) {
			/**
			 * would've been in stacked-rebase/
			 * now will be   in stacked-rebase/tmp/
			 */
			const insideDir: string = createPathForStackedRebase("stacked-rebase.tmp");

			parsed = {
				pathToStackedRebaseDirInsideDotGit: insideDir,
				pathToStackedRebaseTodoFile: path.join(insideDir, filenames.gitRebaseTodo),
			};
		} else {
			parsed = {
				pathToStackedRebaseDirInsideDotGit: __default__pathToStackedRebaseDirInsideDotGit,
				pathToStackedRebaseTodoFile: __default__pathToStackedRebaseTodoFile,
			};
		}

		/**
		 * TODO v1: FIXME update usage of this to use the `__default__` instead (in most places except --view-todo)
		 * EDIT: oh but this is what's actually proctecting from e.g. --apply together w/ --view-todo...
		 *
		 * TODO v2.1: instead, extract the `--view-todo` logic & exit early
		 * TODO v2.2: though, also consider we'll want `--dry-run` in the future & the current approach might be better.
		 *
		 * TODO v3: okay nevermind re: v1, and yes v2.2 -- now that we're completely isolating into a separate dir
		 * if it's --view-todo,
		 */
		const pathToStackedRebaseDirInsideDotGit: string = parsed.pathToStackedRebaseDirInsideDotGit;
		const pathToStackedRebaseTodoFile: string = parsed.pathToStackedRebaseTodoFile;

		const checkIsRegularRebaseStillInProgress = (): boolean => fs.existsSync(pathToRegularRebaseDirInsideDotGit);

		const initialBranch: Git.Reference | void = await Git.Branch.lookup(
			repo, //
			nameOfInitialBranch,
			Git.Branch.BRANCH.ALL
		);
		if (!initialBranch) {
			throw new Error("initialBranch lookup failed");
		}

		const currentBranch: Git.Reference = await repo.getCurrentBranch();

		if (fs.existsSync(path.join(pathToStackedRebaseDirInsideDotGit, filenames.willNeedToApply))) {
			_markThatNeedsToApply(pathToStackedRebaseDirInsideDotGit);
		}

		if (options.apply) {
			return await apply({
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				rootLevelCommandName: "--apply",
				gitCmd: options.gitCmd,
				initialBranch,
				currentBranch,
			});
		}

		if (options.continue) {
			execSyncInRepo(`${options.gitCmd} rebase --continue`);

			if (checkIsRegularRebaseStillInProgress()) {
				/**
				 * still not done - further `--continue`s will be needed.
				 */
				return;
			}

			console.log("after --continue, rebase done. trying to --apply");

			/**
			 * rebase has finished. we can try to --apply now
			 * so that the partial branches do not get out of sync.
			 */
			await applyIfNeedsToApply({
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				rootLevelCommandName: "--apply (automatically after --continue)",
				gitCmd: options.gitCmd,
				autoApplyIfNeeded: configValues.autoApplyIfNeeded,
				config,
				initialBranch,
				currentBranch,
			});

			return;
		}

		const { neededToApply, userAllowedToApplyAndWeApplied, markThatNeedsToApply } = await applyIfNeedsToApply({
			repo,
			pathToStackedRebaseTodoFile,
			pathToStackedRebaseDirInsideDotGit, //
			rootLevelCommandName: "--apply",
			gitCmd: options.gitCmd,
			autoApplyIfNeeded: configValues.autoApplyIfNeeded,
			config,
			initialBranch,
			currentBranch,
		});

		if (neededToApply && !userAllowedToApplyAndWeApplied) {
			return;
		}

		if (options.push) {
			if (!options.forcePush) {
				throw new Termination("\npush without --force will fail (since git rebase overrides history).\n\n");
			}

			return await forcePush({
				repo, //
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit,
				rootLevelCommandName: "--push --force",
				gitCmd: options.gitCmd,
				initialBranch,
				currentBranch,
			});
		}

		if (options.branchSequencer) {
			if (options.branchSequencerExec) {
				const toExec: string = options.branchSequencerExec;

				return branchSequencer({
					gitCmd: options.gitCmd,
					repo,
					rootLevelCommandName: "--branch-sequencer --exec",
					actionInsideEachCheckedOutBranch: ({ execSyncInRepo: execS }) => (execS(toExec), void 0),
					pathToStackedRebaseDirInsideDotGit,
					pathToStackedRebaseTodoFile,
					initialBranch,
					currentBranch,
					behaviorOfGetBranchBoundaries:
						BehaviorOfGetBranchBoundaries[
							"if-stacked-rebase-in-progress-then-parse-not-applied-state-otherwise-simple-branch-traverse"
						],
					reverseCheckoutOrder: false,
				});
			} else {
				/**
				 * we'll likely end up adding more sub-commands
				 * to branchSequencer later.
				 */

				throw new Termination("\n--branch-sequencer (without --exec) - nothing to do?\n\n");
			}
		}

		const wasRegularRebaseInProgress: boolean = checkIsRegularRebaseStillInProgress();
		// const

		console.log({ wasRegularRebaseInProgress });

		if (wasRegularRebaseInProgress) {
			throw new Termination("regular rebase already in progress");
		}

		/**
		 * only create the dir now, when it's needed.
		 * otherwise, other commands can incorrectly infer
		 * that our own stacked rebase is in progress,
		 * when it's not, up until now.
		 */
		fs.mkdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });

		await createInitialEditTodoOfGitStackedRebase(
			repo, //
			initialBranch,
			currentBranch,
			// __default__pathToStackedRebaseTodoFile
			pathToStackedRebaseTodoFile,
			configValues.autoSquash
			// () =>
			// 	getWantedCommitsWithBranchBoundariesUsingNativeGitRebase({
			// 		gitCmd: options.gitCmd,
			// 		repo,
			// 		initialBranch,
			// 		currentBranch,
			// 		dotGitDirPath,
			// 		pathToRegularRebaseTodoFile,
			// 		pathToStackedRebaseTodoFile,
			// 		pathToRegularRebaseDirInsideDotGit,
			// 	})
		);

		if (!wasRegularRebaseInProgress || options.viewTodoOnly) {
			try {
				if (options.editor instanceof Function) {
					await options.editor({ filePath: pathToStackedRebaseTodoFile });
				} else {
					process.stdout.write("\nhint: Waiting for your editor to close the file... ");
					execSyncInRepo(`${options.editor} ${pathToStackedRebaseTodoFile}`);
				}
			} catch (_e) {
				/**
				 * cleanup
				 */
				fs.unlinkSync(pathToStackedRebaseTodoFile);
				if (isDirEmptySync(pathToStackedRebaseDirInsideDotGit)) {
					fs.rmdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });
				}

				throw new Termination(`error: There was a problem with the editor '${options.editor}'.\n`);
			}
		}

		if (options.viewTodoOnly) {
			fs.rmdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });

			const dirname = path.basename(pathToStackedRebaseDirInsideDotGit);

			process.stdout.write(`removed ${dirname}/\n`);

			return;
		}

		const regularRebaseTodoLines: string[] = [];

		/**
		 * part 1 of "the different ways to launch git rebase"
		 */
		regularRebaseTodoLines.push("break");

		const goodCommands: GoodCommand[] = parseTodoOfStackedRebase(pathToStackedRebaseTodoFile);

		// eslint-disable-next-line no-inner-declarations
		async function createBranchForCommand(
			cmd: GoodCommand & { commandName: StackedRebaseCommand & "branch-end-new" }
		): Promise<void> {
			const newBranchName: string = cmd.targets![0];
			const force: number = 0;
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const targetCommitSHA: string = cmd.commitSHAThatBranchPointsTo!;
			const targetCommit: Git.Commit = await Git.Commit.lookup(repo, targetCommitSHA);
			await Git.Branch.create(repo, newBranchName, targetCommit, force);
		}

		/**
		 * TODO should probably go into `validator`
		 */
		const oldLatestBranchCmdIndex: number = goodCommands.findIndex((cmd) => cmd.commandName === "branch-end-last");
		// if (indexOfLatestBranch === -1) // TODO verify in validator

		const isThereANewLatestBranch: boolean = oldLatestBranchCmdIndex !== goodCommands.length - 1;

		if (isThereANewLatestBranch) {
			let newLatestBranchCmdIndex: number | null = null;
			let userOnlyReorderedWithoutCreatingNew: boolean = false;
			for (let i = goodCommands.length - 1; i >= 0; i--) {
				const cmd = goodCommands[i];
				if (cmd.commandName === "branch-end-new") {
					newLatestBranchCmdIndex = i;
					break;
				}
			}
			if (newLatestBranchCmdIndex === null || newLatestBranchCmdIndex <= oldLatestBranchCmdIndex) {
				/**
				 * check if wanted to re-order w/o creating a new branch
				 */
				const hasExistingBranchAsLatest: boolean =
					goodCommands[goodCommands.length - 1].commandName === "branch-end";

				if (newLatestBranchCmdIndex === null && hasExistingBranchAsLatest) {
					newLatestBranchCmdIndex = goodCommands.length - 1;
					userOnlyReorderedWithoutCreatingNew = true;
				} else {
					// TODO validator
					const when =
						newLatestBranchCmdIndex === null
							? "at all"
							: newLatestBranchCmdIndex <= oldLatestBranchCmdIndex
							? "after the branch-end-latest command"
							: ""; // assertNever(newLatestBranchCmdIndex);

					throw new Termination(
						"\n" +
							`apparently a new latest branch was attempted (by adding commands _after_ the "branch-end-last")` +
							`\nbut there was no "branch-end-new" command (${when})`
					);
				}
			}

			/**
			 * strategy:
			 *
			 * 1. create the "branch-end-new" at the appropriate position
			 *
			 * now, both the new & the old "latest" branches are pointing to the same commit
			 *
			 * 2. reset the old "latest" branch to the newly provided, earlier position
			 *
			 * 3. update the command names of the 2 branches
			 *    3.1 in "goodCommands"
			 *    3.2 in our "git-rebase-todo" file?
			 *
			 *
			 * strategy v2:
			 * 1. same
			 * 2.
			 *
			 *
			 * note 1:
			 * in general, idk if this is the best approach.
			 * though, it requries the least amount of effort from the user, afaik.
			 *
			 * if we instead made the user manually move the "branch-end-latest" to an earlier position (normal / same as here),
			 * but the also rename it to "branch-end" (extra work),
			 * and then create a new "branch-end-latest" in the very end (normal / similar to here (just "-latest" instead of "-new")),
			 *
			 * it's more steps, and idk if it conveys the picture well,
			 * because we no longer say "branch-end-new" explicitly,
			 * nor is it explicit that the "branch-end-last" has been moved.
			 *
			 * so then yes, the alternative sucks,
			 * & this (branch-end-last being not the latest command) is good.
			 *
			 * note 2:
			 * TODO will most likely need to do extra handling for the `rebaseChangedLocalHistory`,
			 * because even tho we won't change local history _of the commits_,
			 * the branches do indeed change, and here it's not simply adding a branch in the middle
			 * (though does that also need extra handling?),
			 * we're changing the latest branch, so it matters a lot
			 * and would need to run the `--apply`
			 * (currently `rebaseChangedLocalHistory` would prevent `--apply` from running).
			 *
			 * note 2.1:
			 * TODO need to support a use-case where the new latest branch
			 * is not new, i.e. user has had already created it,
			 * and now has simply moved it after the "branch-end-last".
			 *
			 * note 3:
			 * this logic implies that we should always be doing `--apply`,
			 * TODO thus consider.
			 *
			 * note 2.2 / 3.1:
			 * oh, we actually should be doing the `--apply` in a lot more cases,
			 * e.g. when a local branch is moved (currently we don't!)
			 *
			 */
			const oldLatestBranchCmd: GoodCommandStacked = goodCommands[oldLatestBranchCmdIndex] as GoodCommandStacked; // TODO TS
			const newLatestBranchCmd: GoodCommandStacked = goodCommands[newLatestBranchCmdIndex] as GoodCommandStacked; // TODO TS

			if (!userOnlyReorderedWithoutCreatingNew) {
				/**
				 * create the new "latest branch"
				 */
				await createBranchForCommand(newLatestBranchCmd as any); // TODO TS
			}

			/**
			 * move the old "latest branch" earlier to it's target
			 */
			await repo.checkoutBranch(oldLatestBranchCmd.targets![0]);
			const commit: Git.Commit = await Git.Commit.lookup(repo, oldLatestBranchCmd.commitSHAThatBranchPointsTo!);
			await Git.Reset.reset(repo, commit, Git.Reset.TYPE.HARD, {});

			/**
			 * go to the new "latest branch".
			 */
			await repo.checkoutBranch(newLatestBranchCmd.targets![0]);

			/**
			 * TODO FIXME don't do this so hackishly lmao
			 */
			const editedRebaseTodo: string = fs.readFileSync(pathToStackedRebaseTodoFile, { encoding: "utf-8" });
			const linesOfEditedRebaseTodo: string[] = editedRebaseTodo.split("\n");

			replaceCommandInText(oldLatestBranchCmd, ["branch-end-last"], "branch-end");
			replaceCommandInText(
				newLatestBranchCmd, //
				userOnlyReorderedWithoutCreatingNew ? ["branch-end", "be"] : ["branch-end-new", "ben"],
				"branch-end-last"
			);

			// eslint-disable-next-line no-inner-declarations
			function replaceCommandInText(
				cmd: GoodCommandStacked, //
				allowedOldName: Single<StackedRebaseCommand> | Tuple<StackedRebaseCommand, StackedRebaseCommandAlias>,
				newName: StackedRebaseCommand
			): void {
				const words = linesOfEditedRebaseTodo[cmd.lineNumber].split(" ");
				assert(
					allowedOldName.some((n) => n === words[0]),
					`invalid old name of command in git-rebase-todo file. got "${words[0]}", expected one of "${allowedOldName}".`
				);
				words[0] = newName;
				console.log({ before: linesOfEditedRebaseTodo[cmd.lineNumber] });
				linesOfEditedRebaseTodo[cmd.lineNumber] = words.join(" ");
				console.log({ after: linesOfEditedRebaseTodo[cmd.lineNumber] });
			}

			fs.writeFileSync(pathToStackedRebaseTodoFile, linesOfEditedRebaseTodo.join("\n"), { encoding: "utf-8" });

			/**
			 * TODO RE-PARSE ALL COMMANDS FROM THE FILE INSTEAD
			 */
			oldLatestBranchCmd.commandName = "branch-end";
			oldLatestBranchCmd.commandOrAliasName = "branch-end";

			newLatestBranchCmd.commandName = "branch-end-last";
			newLatestBranchCmd.commandOrAliasName = "branch-end-last";

			/**
			 * it's fine if the new "latest branch" does not have
			 * a remote set yet, because `--push` handles that,
			 * and we regardless wouldn't want to mess anything
			 * in the remote until `--push` is used.
			 */
		}

		for (const cmd of goodCommands) {
			if (cmd.rebaseKind === "regular") {
				regularRebaseTodoLines.push(cmd.fullLine);
			} else if (cmd.rebaseKind === "stacked") {
				if (cmd.commandName === "branch-end-new") {
					await createBranchForCommand(cmd as any); // TODO TS
				}
			} else {
				assertNever(cmd);
			}
		}

		setupPostRewriteHookFor("git-stacked-rebase", {
			dotGitDirPathForInstallingTheHook: dotGitDirPath,
			rewrittenListOutputDirPathThatWillBeInsideDotGitDir: path.basename(pathToStackedRebaseDirInsideDotGit),
		});

		/**
		 * libgit2's git rebase is sadly not very powerful
		 * and quite outdated...
		 * (checked C version too - same story).
		 *
		 */

		const regularRebaseTodo: string = regularRebaseTodoLines.join("\n") + "\n";

		console.log({
			regularRebaseTodo,
			pathToRegularRebaseTodoFile,
		});

		const getCurrentCommit = (): Promise<string> => repo.getHeadCommit().then((c) => c.sha());

		const commitShaOfCurrentCommit: string = await getCurrentCommit();

		// /**
		//  * too bad libgit2 is limited. oh well, i've seen worse.
		//  *
		//  * this passes it off to the user.
		//  *
		//  * they'll come back to us once they're done,
		//  * with --apply or whatever.
		//  *
		//  */
		// execSyncInRepo(`${options.gitCmd} rebase --continue`);

		const preparedRegularRebaseTodoFile = path.join(
			pathToStackedRebaseDirInsideDotGit,
			filenames.gitRebaseTodo + ".ready"
		);
		fs.writeFileSync(preparedRegularRebaseTodoFile, regularRebaseTodo);

		const editorScript = `\
#!/usr/bin/env bash	

mv -f "${preparedRegularRebaseTodoFile}" "${pathToRegularRebaseTodoFile}"

		`;
		const editorScriptPath: string = path.join(dotGitDirPath, "editorScript.doActualRebase.sh");
		fs.writeFileSync(editorScriptPath, editorScript, { mode: "777" });

		const commitOfInitialBranch: Git.Oid = await referenceToOid(initialBranch); // bb
		const commitOfCurrentBranch: Git.Oid = await referenceToOid(currentBranch);

		// https://stackoverflow.com/a/1549155/9285308
		const latestCommitOfOursThatInitialBranchAlreadyHas: Git.Oid = await Git.Merge.base(
			repo, //
			commitOfInitialBranch,
			commitOfCurrentBranch
		);

		execSyncInRepo(
			[
				options.gitCmd, //
				"rebase",
				"--interactive",
				latestCommitOfOursThatInitialBranchAlreadyHas.tostrS(),
				"--onto",
				initialBranch.name(),
				configValues.gpgSign ? "--gpg-sign" : "",
			].join(" "),
			{
				env: {
					// https://git-scm.com/docs/git-rebase#Documentation/git-rebase.txt-sequenceeditor
					GIT_SEQUENCE_EDITOR: editorScriptPath,
				},
			}
		);
		console.log("big buns - the proper rebase returned");

		/**
		 * will need to apply, unless proven otherwise
		 */
		fs.writeFileSync(path.join(pathToStackedRebaseDirInsideDotGit, filenames.willNeedToApply), "");

		/**
		 * part 2 of "the different ways to launch git rebase"
		 */
		execSyncInRepo(`${options.gitCmd} rebase --continue`);

		/**
		 * if the rebase finishes and ONLY THEN EXITS,
		 * it's fine and we continue.
		 *
		 * otherwise, there was some commands that made the git rebase exit
		 * in order to allow the user to perform actions
		 * (i.e. break, edit),
		 * and thus the `execSync` command will exit and if we ran,
		 * we'd run without the actual rebase having finished,
		 *
		 * so the information would be incomplete
		 * and we'd cause other actions that will further f it up.
		 *
		 * thus, to avoid this, we exit ourselves if the regular rebase
		 * is still in progress.
		 *
		 * ---
		 *
		 * note: we would not have to deal with this if we implemented git rebase ourselves here,
		 * but that'd be a lot of work + maintainability,
		 * + also we'd need to
		 *
		 * edit: wait nvm, we'd fall into the same issues in the same exact scenarios
		 * (because we are interactive, but break off as soon as need manual input from user
		 * and cannot get it without exiting),
		 * so no, this is a given then.
		 *
		 */
		// taken from "part 1" from "canAndShouldBeApplying" from below,
		// though using the actual (regular) rebase folder instead of ours
		const isRegularRebaseStillInProgress: boolean = fs.existsSync(
			path.join(pathToRegularRebaseDirInsideDotGit, filenames.rewrittenList)
		);

		if (isRegularRebaseStillInProgress) {
			return;
		}

		// await repo.continueRebase(undefined as any, () => {
		// 	//
		// });
		// await repo.continueRebase(Git.Signature.create(Git.CredUsername.name(), (await Git));
		// const rebase: Git.Rebase = await Git.Rebase.open(repo);

		// console.log({ rebase });

		// let i = 0;
		// while (++i < 30) {
		// 	const gitOp: Git.RebaseOperation = await rebase.next();
		// 	noop(gitOp);
		// }

		// const rebase = await Git.Rebase.init()

		console.log("CONTINUING AFTER EXEC SYNC rebase --continue");

		const commitShaOfNewCurrentCommit = await getCurrentCommit();
		const rebaseChangedLocalHistory: boolean = commitShaOfCurrentCommit !== commitShaOfNewCurrentCommit;

		console.log({
			rebaseChangedLocalHistory, //
			commitShaOfOldCurrentCommit: commitShaOfCurrentCommit,
			commitShaOfNewCurrentCommit,
		});
		console.log("");

		fs.unlinkSync(path.join(pathToStackedRebaseDirInsideDotGit, filenames.willNeedToApply));
		if (rebaseChangedLocalHistory) {
			markThatNeedsToApply();
		} else {
			// /**
			//  * TODO `unmarkThatNeedsToApply` (NOT the same as `markThatApplied`!)
			//  */
			// // unmarkThatNeedsToApply();
		}

		/**
		 * TODO might need to always enable,
		 * but before more testing,
		 * optional is good, since we ask anyway
		 * before proceeding w/ other commands way above.
		 */
		if (configValues.autoApplyIfNeeded) {
			/**
			 * since we're invoking `git rebase --continue` directly (above),
			 * we do not have the control over it.
			 *
			 * meaning that in case it's the very first rebase,
			 * the `rewritten-list` in `.git/rebase-merge/`
			 * (the actual git-rebase, not ours)
			 * file is not generated yet,
			 *
			 * and since we depend on the `git rebase --continue` (the regular rebase)
			 * to generate the `rewritten-list` file,
			 * we explode trying to read the file if we try to --apply below.
			 *
			 * ---
			 *
			 * edit: oh wait nvm, it's potentially any rebase that has
			 * `break` or `edit` or similar right??
			 *
			 * because if the git-rebase-todo file has `break` or `edit`
			 * or similar commands that make `git rebase --continue` exit
			 * before it's fully completed, (my theory now is that) our code here proceeds
			 * and tries to --apply, but again the rewritten-list file
			 * doesn't exist yet, so we blow up.
			 *
			 * ---
			 *
			 * let's try to account for only the 1st scenario first.
			 * TODO implement directly in `--apply`
			 * (e.g. if user calls `gitStackedRebase` again, while still in a rebase)
			 *
			 * upd: ok let's also do the 2nd one because it's useless otherwise
			 *
			 */
			const canAndShouldBeApplying: boolean =
				/** part 1 */ fs.existsSync(path.join(pathToStackedRebaseDirInsideDotGit, filenames.rewrittenList)) &&
				/** part 2 (incomplete?) */ !fs.existsSync(pathToRegularRebaseDirInsideDotGit) &&
				/** part 2 (complete?) (is this even needed?) */ goodCommands.every(
					(cmd) => !namesOfRebaseCommandsThatMakeRebaseExitToPause.includes(cmd.commandName)
				);

			if (canAndShouldBeApplying) {
				await applyIfNeedsToApply({
					repo,
					pathToStackedRebaseTodoFile,
					pathToStackedRebaseDirInsideDotGit, //
					rootLevelCommandName: "--apply",
					gitCmd: options.gitCmd,
					autoApplyIfNeeded: configValues.autoApplyIfNeeded,
					config,
					initialBranch,
					currentBranch,
				});
			}
		}

		/**
		 * execute the post-stacked-rebase hook if exists.
		 * will only happen if the rebase went thru, and in our control.
		 */
		const postStackedRebaseHook: string = path.join(dotGitDirPath, "hooks", filenames.postStackedRebaseHook);
		if (fs.existsSync(postStackedRebaseHook)) {
			execSyncInRepo(postStackedRebaseHook);
		}

		return;
	} catch (e) {
		throw e; // TODO FIXME - no try/catch at all?
	}
};

function referenceToOid(ref: Git.Reference): Promise<Git.Oid> {
	return ref.peel(Git.Object.TYPE.COMMIT).then((x) => x.id());
}

export function removeUndefinedProperties<T, K extends keyof Partial<T>>(
	object: Partial<T> //
): Partial<T> {
	return (
		Object.keys(object).forEach(
			(k) =>
				k in object && //
				object[k as K] === undefined &&
				delete object[k as K]
		),
		object
	);
}

async function createInitialEditTodoOfGitStackedRebase(
	repo: Git.Repository, //
	initialBranch: Git.Reference,
	currentBranch: Git.Reference,
	pathToRebaseTodoFile: string,
	autoSquash: boolean,
	getCommitsWithBranchBoundaries: () => Promise<CommitAndBranchBoundary[]> = () =>
		getWantedCommitsWithBranchBoundariesOurCustomImpl(
			repo, //
			initialBranch,
			currentBranch
		)
): Promise<void> {
	// .catch(logErr);

	// if (!bb) {
	// 	console.error();
	// 	return;
	// }

	const commitsWithBranchBoundaries: CommitAndBranchBoundary[] = await getCommitsWithBranchBoundaries();

	// /**
	//  * TODO: FIXME HACK for nodegit rebase
	//  */
	// const p = path.join(repo.path(), "rebase-merge");
	// fs.mkdirSync(p, { recursive: true });
	// commitsWithBranchBoundaries.map((c, i) => {
	// 	const f = path.join(p, `cmt.${i + 2}`);
	// 	fs.writeFileSync(f, c.commit.sha() + "\n");
	// });
	// const last = commitsWithBranchBoundaries.length - 1;
	// const ff = path.join(p, `cmt.${last + 2}`);
	// fs.writeFileSync(ff, `${commitsWithBranchBoundaries[last].commit.sha()}`);

	noop(commitsWithBranchBoundaries);

	if (autoSquash) {
		await autosquash(repo, commitsWithBranchBoundaries);
	}

	const rebaseTodo = commitsWithBranchBoundaries
		.map(({ commit, commitCommand, branchEnd }, i) => {
			if (i === 0) {
				assert(!!branchEnd?.length, `very first commit has a branch (${commit.sha()}).`);
				assert.strictEqual(branchEnd.length, 1, "must be only a single initial branch");

				// return [];
				return [
					// `pick ${commit.sha()} ${commit.summary()}`,
					/**
					 * TODO refs/REMOTES/* instead of refs/HEADS/*
					 */
					`branch-end-initial ${branchEnd[0].name()}`, //
				];
			}

			if (i === commitsWithBranchBoundaries.length - 1) {
				assert(!!branchEnd?.length, `very last commit has a branch. sha = ${commit.sha()}`);

				return [
					`${commitCommand} ${commit.sha()} ${commit.summary()}`,
					`branch-end-last ${currentBranch.name()}`, //
				];
			}

			if (branchEnd?.length) {
				return [
					`${commitCommand} ${commit.sha()} ${commit.summary()}`,
					...branchEnd.map((x) => `branch-end ${x.name()}`), //
				];
			}

			return [
				`${commitCommand} ${commit.sha()} ${commit.summary()}`, //
			];
		})
		.filter((xs) => xs.length)
		.flat();

	fs.writeFileSync(pathToRebaseTodoFile, rebaseTodo.join("\n"));

	return;
}

export async function getCommitHistory(
	repo: Git.Repository, //
	handleCommit: (
		commit: Git.Commit, //
		collectAndStop: () => void
	) => void = () => {
		//
	}
): Promise<Git.Commit[]> {
	const commit: Git.Commit = await repo.getHeadCommit();
	const commitEmitter = commit.history();

	const collectedCommits: Git.Commit[] = [];

	return new Promise((resolve, reject) => {
		const resolveCommits = (commits: Git.Commit[]): void => {
			commitEmitter.removeAllListeners();
			resolve(commits);
		};

		commitEmitter.on("commit", (c) => {
			collectedCommits.push(c);
			handleCommit(c, () => resolveCommits(collectedCommits));
		});

		commitEmitter.on("end", (allCommits) => resolveCommits(allCommits));

		commitEmitter.on("error", (c) => {
			console.error("error", { c });
			reject(c);
		});

		commitEmitter.start();
	});
}

async function getCommitHistoryUntilIncl(repo: Git.Repository, untilOid: Git.Oid): Promise<Git.Commit[]> {
	return getCommitHistory(repo, (commit, collectAndStop) => {
		const matched = !commit.id().cmp(untilOid);
		if (matched) {
			collectAndStop();
		}
	});
}

export async function getFileStatuses(repo: Git.Repository) {
	const fileStatuses = await repo.getStatusExt();

	const receivedStatuses = fileStatuses.map((statusFile) => {
		const results = callAll((statusFile as unknown) as KeyToFunctionMap);
		console.log({ results });
		return results;
	});

	return receivedStatuses;
}

type KeyToFunctionMap = { [key in string | number | symbol]: Function };

function callAll(keyToFunctionMap: KeyToFunctionMap) {
	return Object.entries(keyToFunctionMap).reduce(
		(acc, [k, v]) => ({ ...acc, [k]: v instanceof Function ? v() : v }),
		{}
	);
}

export type CommitAndBranchBoundary = {
	commit: Git.Commit;
	commitCommand: RegularRebaseEitherCommandOrAlias;
	branchEnd: Git.Reference[] | null;
};

export async function getWantedCommitsWithBranchBoundariesOurCustomImpl(
	repo: Git.Repository, //
	/** beginningBranch */
	bb: Git.Reference,
	currentBranch: Git.Reference
): Promise<CommitAndBranchBoundary[]> {
	/**
	 * BEGIN check e.g. fork & origin/fork
	 */
	// const branchNamesFixed: string[] = branches.map((b) => fixBranchName(b.name()));

	// const n = branches.length;
	// const secondLast = branchNamesFixed[n - 1];
	// const last = branchNamesFixed[n - 2];
	// assert(secondLast.includes(last), `second-last branch part of last branch (${secondLast} includes ${last})`);

	// branches.splice(n - 2, 1);
	// branchNamesFixed.splice(n - 2, 1);

	// console.log({ branchNamesFixed });
	/**
	 * END check e.g. fork & origin/fork
	 */

	//

	console.log({
		//
		bb,
		str: bb.toString(),
		name: bb.name(),
		peeled: (await bb.peel(Git.Object.TYPE.ANY)).id().tostrS(),
		resolved: (await bb.resolve()).name(),
	});

	const commitOfInitialBranch: Git.Oid = await referenceToOid(bb);
	const commitOfCurrentBranch: Git.Oid = await referenceToOid(currentBranch);

	// https://stackoverflow.com/a/1549155/9285308
	const latestCommitOfOursThatInitialBranchAlreadyHas: Git.Oid = await Git.Merge.base(
		repo, //
		commitOfInitialBranch,
		commitOfCurrentBranch
	);
	console.log({
		latestCommitOfOursThatInitialBranchAlreadyHas: latestCommitOfOursThatInitialBranchAlreadyHas.tostrS(),
	});

	const commitOfInitialBranchAsCommit: Git.Commit = await Git.Commit.lookup(repo, commitOfInitialBranch);

	const wantedCommits: Git.Commit[] = await getCommitHistoryUntilIncl(
		repo, //
		latestCommitOfOursThatInitialBranchAlreadyHas
	).then(
		(commits) => (
			commits.pop() /** remove the unwanted commit that initial branch already has, that we have too */,
			commits.push(commitOfInitialBranchAsCommit) /** add the commit of the initial branch itself */,
			/**
			 * the operations above are pop() and push(), instead of shift() and unshift()
			 * (operate at end of array, instead of the start),
			 *
			 * because of how the `getCommitHistoryUntilIncl` returns the commits
			 * (the order - from newest to oldest).
			 *
			 * TODO FIXME - this is done later, but probably should be done directly
			 * in the underlying function to avoid confusion.
			 */
			commits.reverse()
		)
	);

	return extendCommitsWithBranchEnds(repo, bb, currentBranch, wantedCommits);
}

noop(getWantedCommitsWithBranchBoundariesUsingNativeGitRebase);
async function getWantedCommitsWithBranchBoundariesUsingNativeGitRebase({
	gitCmd,
	repo,
	initialBranch,
	currentBranch,
	dotGitDirPath,
	pathToRegularRebaseTodoFile,
	pathToStackedRebaseTodoFile,
	pathToRegularRebaseDirInsideDotGit,
}: {
	gitCmd: string;
	repo: Git.Repository; //
	initialBranch: Git.Reference;
	currentBranch: Git.Reference;
	dotGitDirPath: string;
	pathToRegularRebaseTodoFile: string;
	pathToStackedRebaseTodoFile: string;
	pathToRegularRebaseDirInsideDotGit: string;
}): Promise<CommitAndBranchBoundary[]> {
	const referenceToOid = (ref: Git.Reference): Promise<Git.Oid> =>
		ref.peel(Git.Object.TYPE.COMMIT).then((x) => x.id());

	// const commitOfInitialBranch: Git.Oid = await referenceToOid(bb);
	const commitOfInitialBranch: Git.Oid = await referenceToOid(initialBranch);
	const commitOfCurrentBranch: Git.Oid = await referenceToOid(currentBranch);

	// https://stackoverflow.com/a/1549155/9285308
	const latestCommitOfOursThatInitialBranchAlreadyHas: Git.Oid = await Git.Merge.base(
		repo, //
		commitOfInitialBranch,
		commitOfCurrentBranch
	);

	const regularRebaseDirBackupPath: string = pathToRegularRebaseDirInsideDotGit + ".backup-from-1st";

	const editorScriptSuccessIndicator: string = path.join(regularRebaseDirBackupPath, "success");
	const checkIfSucceeded = (): boolean => fs.existsSync(editorScriptSuccessIndicator);

	/** BEGIN COPY-PASTA */

	const editorScript = `\
#!/usr/bin/env bash

# remove beforehand
rm -rf ${editorScriptSuccessIndicator}

printf "yes sir\n\n"

pushd "${dotGitDirPath}"

printf "pwd: $(pwd)\n"

# cat rebase-merge/git-rebase-todo
cat ${pathToRegularRebaseTodoFile}

# cat ${pathToRegularRebaseTodoFile} > ${pathToStackedRebaseTodoFile}.regular
cp -r ${pathToRegularRebaseDirInsideDotGit} ${regularRebaseDirBackupPath}

# indicate success (MUST BE THE LAST COMMAND BEFORE EXITING)
touch ${editorScriptSuccessIndicator}

# abort the rebase before even starting it --
# we get what we want - the git-rebase-todo file,
# and we exit so that the rebase won't proceed
# and wil cleanup instead.
exit 1
			`;
	const editorScriptPath: string = path.join(dotGitDirPath, "editorScript.sh");
	fs.writeFileSync(editorScriptPath, editorScript, { mode: "777" });
	console.log("wrote editorScript");

	try {
		const execSyncInRepo = createExecSyncInRepo(repo);

		const cmd = [
			gitCmd,
			/**
			 * we need the full SHA.
			 *
			 * https://git-scm.com/docs/git-rebase#Documentation/git-rebase.txt-rebaseinstructionFormat
			 * https://git-scm.com/docs/git-log#Documentation/git-log.txt-emHem
			 *
			 */
			"-c rebase.instructionFormat='%H'",
			"rebase",
			"--interactive",
			latestCommitOfOursThatInitialBranchAlreadyHas.tostrS() +
				"~" /** include self (needed for initialBranch's boundary) */,
			"--onto",
			initialBranch.name(),
			/**
			 * TODO FIXME need to remove the "--no-autosquash",
			 * but for that, will need to do further analysis
			 * to connect the moved commits,
			 * because if the latest commit was fixed up/squashed/etc
			 * (which is very common if fixing up, at least for me),
			 * then the latest branch will point to the updated, earlier location,
			 * thus newer commits will be lost.
			 *
			 * i imagine we could combine this "native git rebase" mechanism
			 * with our own "CustomImpl" to achieve this,
			 * but need to do more research.
			 */
			"--no-autosquash",
			">/dev/null",
		].join(" ");

		console.log("launching internal rebase with editorScript to create initial todo:\n%s", cmd);

		execSyncInRepo(cmd, {
			env: {
				// https://git-scm.com/docs/git-rebase#Documentation/git-rebase.txt-sequenceeditor
				GIT_SEQUENCE_EDITOR: editorScriptPath,
			},
			stdio: "pipe",
		});
	} catch (e) {
		if (!checkIfSucceeded()) {
			throw e;
		} else {
			// as expected. do nothing & continue.
		}
	}

	console.log("rebase -i exited successfully");

	/** END COPY-PASTA */

	const goodRegularCommands: GoodCommandRegular[] = parseTodoOfStackedRebase(
		path.join(regularRebaseDirBackupPath, filenames.gitRebaseTodo)
	).map((cmd) => {
		assert(
			cmd.commandName in regularRebaseCommands,
			`git-rebase-todo file, created via regular git rebase, contains non-rebase commands (got "${cmd.commandName}")`
		);

		return cmd as GoodCommandRegular;
	});

	if (fs.existsSync(regularRebaseDirBackupPath)) {
		fs.rmdirSync(regularRebaseDirBackupPath, { recursive: true });
	}

	/**
	 * TODO - would now have to use the logic from `getWantedCommitsWithBranchBoundaries`
	 * & subsequent utils, though adapted differently - we already have the commits,
	 * now we gotta add the branch boundaries & then continue like regular.
	 *
	 */
	const wantedCommitSHAs: Tuple<RegularRebaseEitherCommandOrAlias, string>[] = goodRegularCommands.map((cmd) => {
		/**
		 * 1st is the command name
		 * 2nd is the short commit SHA
		 * 3rd is the long commit SHA, because of our custom `-c rebase.instructionFormat='%H'`
		 */
		const commitSHAFull: string = cmd.fullLine.split(" ")?.[2] || "";
		assert(commitSHAFull);
		return [cmd.commandOrAliasName, commitSHAFull];
	});

	// const commits: Git.Commit[] = await Promise.all(
	// 	wantedCommitSHAs.map((sha) => (console.log("sha %s", sha), Git.Commit.lookup(repo, sha)))
	// );
	const commits: Git.Commit[] = [];
	const commandOrAliasNames: RegularRebaseEitherCommandOrAlias[] = [];
	for (const [commandOrAliasName, sha] of wantedCommitSHAs) {
		// const oid = await Git.Oid.fromString(sha);
		const c = await Git.Commit.lookup(repo, sha);
		commits.push(c);
		commandOrAliasNames.push(commandOrAliasName);
	}

	const commitsWithBranchBoundaries: CommitAndBranchBoundary[] = await extendCommitsWithBranchEnds(
		repo,
		initialBranch,
		currentBranch,
		commits,
		commandOrAliasNames
	);

	return commitsWithBranchBoundaries;
}

async function extendCommitsWithBranchEnds(
	repo: Git.Repository,
	initialBranch: Git.Reference,
	currentBranch: Git.Reference,
	commits: Git.Commit[],
	/**
	 * used for properly assigning the command to a commit,
	 * if it was already provided,
	 * e.g. if --autosquash was used and thus some commands
	 * ended up as `fixup` instead of `pick`.
	 *
	 * by default, will be `pick`.
	 */
	commandOrAliasNames: RegularRebaseEitherCommandOrAlias[] = []
): Promise<CommitAndBranchBoundary[]> {
	const refNames: string[] = await Git.Reference.list(repo);
	const refs: Git.Reference[] = await Promise.all(refNames.map((ref) => Git.Reference.lookup(repo, ref)));

	let matchedRefs: Git.Reference[];

	const removeLocalRegex = /^refs\/heads\//;
	const removeRemoteRegex = /^refs\/remotes\/[^/]*\//;

	const currentBranchCommit: Git.Oid = await referenceToOid(currentBranch);
	noop(currentBranchCommit);

	const extend = (c: Git.Commit, i: number): CommitAndBranchBoundary => (
		(matchedRefs = refs.filter((ref) => !!ref.target()?.equal(c.id()))),
		/**
		 * if there exists a local branch with the same name as a remote one,
		 * then get rid of the remote branch ref,
		 * because the local one will cover it.
		 * (with the exception of the initial branch (it should always be remote)).
		 *
		 * this helps multiple scenarios:
		 *
		 * - a new commit is created in the latest branch, but not pushed to a remote yet.
		 *   (a duplicate remote branch would show up earlier in history,
		 *    meanwhile, for our purposes, it shouldn't)
		 *
		 * - a new latest branch got created (old one was moved previously).
		 *   here, the old remote branch would point to the latest commit,
		 *   i.e. in the new latest branch, i.e. it would be ahead when it shouldn't.
		 *
		 * - possibly others
		 *
		 */
		(matchedRefs = matchedRefs.filter(
			(r) =>
				r.name() === initialBranch.name() ||
				!r.isRemote() ||
				!refs
					.filter((ref) => !ref.isRemote())
					.map((ref) => ref.name().replace(removeLocalRegex, ""))
					.includes(r.name().replace(removeRemoteRegex, ""))
		)),
		// assert(
		// 	matchedRefs.length <= 1 ||
		// 		/**
		// 		 * if it's more than 1,
		// 		 * it's only allowed if all of the branches are the same ones,
		// 		 * just on different remotes.
		// 		 */
		// 		(matchedRefs.length > 1 &&
		// 			uniq(
		// 				matchedRefs.map((r) =>
		// 					r
		// 						?.name()
		// 						.replace(removeLocalRegex, "")
		// 						.replace(removeRemoteRegex, "")
		// 				)
		// 			).length === 1),
		// 	// ||
		// 	// /**
		// 	//  * or, if it's the root branch
		// 	//  */
		// 	// !c.id().cmp(currentBranchCommit),
		// 	"" +
		// 		"2 (or more) branches for the same commit, both in the same path - cannot continue" +
		// 		"(until explicit branch specifying is implemented)" +
		// 		"\n\n" +
		// 		"matchedRefs = " +
		// 		matchedRefs.map((mr) => mr?.name()) +
		// 		"\n"
		// ),
		noop(uniq),
		matchedRefs.length > 1 &&
			(matchedRefs = matchedRefs.some((r) => r?.name() === initialBranch.name())
				? [initialBranch]
				: matchedRefs.filter((r) => !r?.isRemote() /* r?.name().includes("refs/heads/") */)),
		// assert(
		// 	matchedRefs.length <= 1,
		// 	"refs/heads/ and refs/remotes/*/ replacement went wrong." +
		// 		bullets(
		// 			"\nmatchedRefs:",
		// 			matchedRefs.map((r) => r.toString())
		// 		)
		// ),
		{
			commit: c,
			commitCommand: commandOrAliasNames[i] || "pick",
			branchEnd: !matchedRefs.length ? null : matchedRefs,
		}
	);

	const e = commits.map(extend);
	return e;
}

noop(getCommitOfBranch);
async function getCommitOfBranch(repo: Git.Repository, branchReference: Git.Reference) {
	const branchOid: Git.Oid = await (await branchReference.peel(Git.Object.TYPE.COMMIT)).id();
	return await Git.Commit.lookup(repo, branchOid);
}

//

/**
 * the CLI
 */
export async function git_stacked_rebase(): Promise<void> {
	const pkgFromSrc = path.join(__dirname, "package.json");
	const pkgFromDist = path.join(__dirname, "../", "package.json");
	let pkg;

	// eslint-disable-next-line import/no-dynamic-require
	if (fs.existsSync(pkgFromSrc)) pkg = require(pkgFromSrc);
	// eslint-disable-next-line import/no-dynamic-require
	else if (fs.existsSync(pkgFromDist)) pkg = require(pkgFromDist);
	else pkg = {};

	const gitStackedRebaseVersion = pkg.version;

	const gitStackedRebaseVersionStr: string = !gitStackedRebaseVersion ? "" : "v" + gitStackedRebaseVersion;

	const helpMsg = `\

git-stacked-rebase <branch>

    1. will edit/create the todo & will execute the interactive rebase (in the latest branch),
    2. but will not apply the changes to partial branches until --apply is used.
	2.1 unless autoApply is enabled via \`git config [--global] ${configKeys.autoApplyIfNeeded} true'.


git-stacked-rebase <branch> [-a|--apply]

    1. will apply the changes from the latest branch
       to all partial branches (currently, using 'git reset --hard'),
	2. but wil not push the partial branches to a remote until --push --force is used.


git-stacked-rebase <branch> [--push|-p --force|-f]

    1. will checkout each branch and will push --force,
    2. but will NOT have any effect if --apply was not used yet.
	2.1 unless autoApply is enabled.


git-stacked-rebase <branch> [-v|--view-todo|--view-only]

    1. will make git-stacked-rebase work inside a separate, .tmp directory,
        to allow viewing/editing (w/o affecting the actual todo
        nor any subsequent runs that might happen later),
    2. will NOT execute the rebase,
    3. after viewing/editing, will remove the .tmp directory.


git-stacked-rebase [...] --git-dir <path/to/git/dir/> [...]

    makes git-stacked-rebase begin operating inside the specified directory.


git-stacked-rebase [...] -V|--version [...]
git-stacked-rebase [...] -h|--help    [...]


git-stacked-rebase ${gitStackedRebaseVersionStr} __BUILD_DATE_REPLACEMENT_STR__
`.replace(/\t/g, " ".repeat(4));

	if (process.argv.some((arg) => ["-h", "--help"].includes(arg))) {
		process.stdout.write(helpMsg);
		return;
	}

	if (process.argv.some((arg) => ["-V", "--version"].includes(arg))) {
		process.stdout.write(`\ngit-stacked-rebase ${gitStackedRebaseVersionStr}\n\n`);
		return;
	}

	process.argv.splice(0, 2);

	const peakNextArg = (): string | undefined => process.argv[0];
	const eatNextArg = (): string | undefined => process.argv.shift();

	const eatValueOfNonPositionalArg = (
		argNameAndAliases: string[],
		// argName: string | undefined = undefined,
		indexOfArgVal: number | undefined = undefined,
		argVal: string | undefined = undefined
	): typeof argVal => (
		(process.argv = process.argv
			.map((arg, i, args) =>
				i === indexOfArgVal
					? false
					: argNameAndAliases.includes(arg)
					? // ? (((argName = arg), (indexOfArgVal = i + 1), (argVal = args[i + 1])), false)
					  ((indexOfArgVal = i + 1), (argVal = args[i + 1]), false)
					: arg
			)
			.filter((arg) => arg !== false) as string[]),
		argVal
	);

	/**
	 * need to read & get rid of non-positional args & their values first.
	 */

	/**
	 * TODO use value directly from git's `git --git-dir` if possible?
	 * (to get the default, probably)
	 */
	const gitDir: string | undefined = eatValueOfNonPositionalArg(["--git-dir", "--gd"]);

	/**
	 * and now off to positional args.
	 */
	console.log({ "process.argv after non-positional": process.argv });

	const nameOfInitialBranch: string | undefined = eatNextArg();
	if (!nameOfInitialBranch) {
		throw new Termination(helpMsg);
	}

	if (["--continue", "-c"].includes(nameOfInitialBranch) && !process.argv.length) {
		console.log("--continue without initialBranch");

		/**
		 * TODO allow `null` / make optional
		 *
		 * both will need some intellisense to only allow
		 * in specific cases
		 *
		 * (unless we'll keep track of the
		 * current initial branch we're working with?)
		 *
		 */
		const initialBranch = "";

		/**
		 * TODO call more appropraitely / extract default options
		 * so that it's less error-prone here
		 */
		return gitStackedRebase(initialBranch, {
			gitDir,
			continue: true,
		});
	}

	/**
	 * TODO: improve arg parsing, lmao
	 */
	const second = peakNextArg();

	/**
	 * `isViewTodoOnly` is safe because the decision of using the .tmp directory or not
	 * is decided purely by this option,
	 * and **it's impossible to have more options** that would
	 * have side effects for the git repository
	 * (because git-stacked-rebase would be working in the same .tmp directory).
	 *
	 * i.e. if --view-todo is specified, then another option,
	 * such as --edit-todo, or --apply, cannot be specified,
	 * because all of these options are positional
	 * & are the 3rd argument.
	 * additionally, gitStackedRebase checks for these incompatible options
	 * in the library code as well (TODO check all incompatible options).
	 *
	 */
	const isViewTodoOnly: boolean =
		!!second && ["--view-todo", "-v", "--view-only", "--view-todo-only"].includes(second);
	const isApply: boolean = !!second && ["--apply", "-a"].includes(second);
	const isContinue: boolean = !!second && ["--continue", "-c"].includes(second);
	const isPush: boolean = !!second && ["--push", "-p"].includes(second);
	const isBranchSequencer: boolean = !!second && ["--branch-sequencer", "--bs", "-s"].includes(second);

	if (isViewTodoOnly || isContinue || isApply || isPush || isBranchSequencer) {
		eatNextArg();
	}

	let isForcePush: boolean = false;
	let branchSequencerExec: string | false = false;

	if (peakNextArg() && (isPush || isBranchSequencer)) {
		const third = eatNextArg() || "";

		if (isPush) {
			isForcePush = ["--force", "-f"].includes(third);
		} else if (isBranchSequencer) {
			/**
			 * TODO separate --exec & --something
			 * 1. for execing only the next arg (must be quoted), and
			 * 2. for stopping arg parsing & execing everything afterwards (no quoting)
			 *
			 * TODO also allow selecting if want to exec before, after (or both) each branch
			 *
			 */
			const execNames = ["--exec", "-x"];
			if (execNames.includes(third) && peakNextArg()) {
				const fourth = eatNextArg();
				branchSequencerExec = fourth ? fourth : false;
			} else {
				throw new Termination(
					`\n--branch-sequencer can only (for now) be followed by ${execNames.join("|")}\n\n`
				);
			}
		}

		if (!isForcePush && !branchSequencerExec) {
			throw new Termination(`\nunrecognized 3th option (got "${third}")\n\n`);
		}
	}

	if (process.argv.length) {
		throw new Termination(
			"" + //
				"\n" +
				bullets("\nerror - leftover arguments: ", process.argv, "  ") +
				"\n\n"
		);
	}

	const options: SomeOptionsForGitStackedRebase = {
		gitDir,
		viewTodoOnly: isViewTodoOnly,
		apply: isApply,
		continue: isContinue,
		push: isPush,
		forcePush: isForcePush,
		branchSequencer: isBranchSequencer,
		branchSequencerExec,
	};

	// await
	return gitStackedRebase(nameOfInitialBranch, options); //
}

if (!module.parent) {
	git_stacked_rebase() //
		.then(() => process.exit(0))
		.catch((e) => {
			if (e instanceof Termination) {
				process.stderr.write(e.message);
				process.exit(1);
			} else {
				console.error(e);
				process.exit(1);
				// throw e;
			}
		});
}
