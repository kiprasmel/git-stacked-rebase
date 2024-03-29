#!/usr/bin/env ts-node-dev

/* eslint-disable indent */
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import Git from "nodegit";
import fs from "fs";
import path from "path";
import assert from "assert";

import { bullets } from "nice-comment";
import open from "open";

/**
 * separate package (soon)
 */
import { setupPostRewriteHookFor } from "./git-reconcile-rewritten-list/postRewriteHook";
import { Argv, createArgParse, Maybe, maybe, last, MaybeArg } from "./argparse/argparse";

import { filenames } from "./filenames";
import { ConfigValues, configKeys, loadGitConfig } from "./config";
import {
	getDefaultResolvedOptions, //
	ResolvedGitStackedRebaseOptions,
	parseInitialBranch,
	resolveOptions,
	SpecifiableGitStackedRebaseOptions,
} from "./options";
import { apply, applyIfNeedsToApply, askYesNoAlways, markThatNeedsToApply } from "./apply";
import { forcePush } from "./forcePush";
import { BehaviorOfGetBranchBoundaries, branchSequencer } from "./branchSequencer";
import { autosquash } from "./autosquash";
import { askQuestion__internal, editor__internal, EitherEditor } from "./internal";
import { generateListOfURLsToCreateStackedPRs } from "./pullRequestStack";
import { repair } from "./repair";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { noop } from "./util/noop";
import { uniq } from "./util/uniq";
import { parseTodoOfStackedRebase } from "./parse-todo-of-stacked-rebase/parseTodoOfStackedRebase";
import { Termination } from "./util/error";
import { assertNever } from "./util/assertNever";
import { Single, Tuple } from "./util/tuple";
import { isDirEmptySync } from "./util/fs";
import { AskQuestion, Questions, question } from "./util/createQuestion";
import { delay } from "./util/delay";
import { log, GSR_LOGDIR } from "./util/log";
import {
    getParseTargetsCtxFromLine,
	GoodCommand,
	GoodCommandRegular,
	GoodCommandStacked, //
	namesOfRebaseCommandsThatMakeRebaseExitToPause,
	regularRebaseCommands,
	RegularRebaseEitherCommandOrAlias,
	StackedRebaseCommand,
	StackedRebaseCommandAlias,
    stackedRebaseCommands,
    Targets,
} from "./parse-todo-of-stacked-rebase/validator";

export * from "./options";

export async function gitStackedRebase(
	specifiedOptions: SpecifiableGitStackedRebaseOptions = {}
): Promise<void> {
	try {
		const {	repoRootDir, execSyncInRepo } = parsePrereqs(specifiedOptions);

		const repo: Git.Repository = await Git.Repository.open(repoRootDir);
		const config: Git.Config = await loadGitConfig(repo, specifiedOptions);
		const dotGitDirPath: string = repo.path();

		const options: ResolvedGitStackedRebaseOptions = await resolveOptions(specifiedOptions, { config, dotGitDirPath });

		log({ options, repoRootDir });

		const pathToRegularRebaseDirInsideDotGit = path.join(dotGitDirPath, "rebase-merge");
		const pathToStackedRebaseDirInsideDotGit = path.join(dotGitDirPath, "stacked-rebase");

		const pathToRegularRebaseTodoFile = path.join(pathToRegularRebaseDirInsideDotGit, filenames.gitRebaseTodo);
		const pathToStackedRebaseTodoFile = path.join(pathToStackedRebaseDirInsideDotGit, filenames.gitRebaseTodo);

		const initialBranch: Git.Reference = await parseInitialBranch(repo, options.initialBranch);
		const currentBranch: Git.Reference = await repo.getCurrentBranch();

		const checkIsRegularRebaseStillInProgress = (): boolean => fs.existsSync(pathToRegularRebaseDirInsideDotGit);
		const askQuestion: AskQuestion = askQuestion__internal in options ? options[askQuestion__internal]! : question;

		if (fs.existsSync(path.join(pathToStackedRebaseDirInsideDotGit, filenames.willNeedToApply))) {
			markThatNeedsToApply(pathToStackedRebaseDirInsideDotGit);
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

			log("after --continue, rebase done. trying to --apply");

			/**
			 * rebase has finished. we can try to --apply now
			 * so that the partial branches do not get out of sync.
			 */
			await applyIfNeedsToApply({
				isMandatoryIfMarkedAsNeeded: false,
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				rootLevelCommandName: "--apply (automatically after --continue)",
				gitCmd: options.gitCmd,
				autoApplyIfNeeded: options.autoApplyIfNeeded,
				config,
				initialBranch,
				currentBranch,
				askQuestion,
			});

			return;
		}

		await applyIfNeedsToApply({
			/**
			 * at this point, if an `--apply` has been marked as needed, we must perform it.
			 * 
			 * we either a) already know that the user allows it, via options.autoApplyIfNeeded,
			 * or b) if not -- we must ask the user directly if the apply can be performed.
			 * 
			 * if user does not allow us to perform the apply -- we cannot continue, and will terminate.
			 */
			isMandatoryIfMarkedAsNeeded: true,

			repo,
			pathToStackedRebaseTodoFile,
			pathToStackedRebaseDirInsideDotGit, //
			rootLevelCommandName: "--apply",
			gitCmd: options.gitCmd,
			autoApplyIfNeeded: options.autoApplyIfNeeded,
			config,
			initialBranch,
			currentBranch,
			askQuestion,
		});

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

		if (options.pullRequest) {
			const githubFrontendURLsForUserToCreatePRs: string[] = await generateListOfURLsToCreateStackedPRs({
				repo, //
				initialBranch,
				currentBranch,
				ignoredBranches: options.ignoredBranches,
				askQuestion,
			});

			const out = "\n" + githubFrontendURLsForUserToCreatePRs.join("\n") + "\n";
			process.stdout.write(out);

			const shouldOpenURLsInWebBrowser: boolean = await askYesNoAlways({
				questionToAsk: Questions.open_urls_in_web_browser, //
				askQuestion,
				onAllowAlways: async () => {
					const always: ConfigValues["autoOpenPRUrlsInBrowser"] = "always";
					await config.setString(configKeys.autoOpenPRUrlsInBrowser, always);
				},
			});

			if (shouldOpenURLsInWebBrowser) {
				for (const url of githubFrontendURLsForUserToCreatePRs) {
					await open(url);
					await delay(10);
				}
			}

			return;
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

		log({ wasRegularRebaseInProgress });

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

		//
		await createInitialEditTodoOfGitStackedRebase(
			repo, //
			initialBranch,
			currentBranch,
			// __default__pathToStackedRebaseTodoFile
			pathToStackedRebaseTodoFile,
			options.autoSquash,
			options.repair,
			askQuestion,
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

		if (!wasRegularRebaseInProgress) {
			try {
				const editor: EitherEditor =
					editor__internal in options
						? options[editor__internal]!
						: "editor" in options
						? options.editor
						: assertNever(options);

				if (editor instanceof Function) {
					await editor({ filePath: pathToStackedRebaseTodoFile });
				} else {
					process.stdout.write("hint: Waiting for your editor to close the file... ");
					execSyncInRepo(`${editor} ${pathToStackedRebaseTodoFile}`);
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
			const oldTarget: string = oldLatestBranchCmd.targets![0].replace(removeLocalRegex, "");
			execSyncInRepo(`${options.gitCmd} checkout ${oldTarget}`);

			const commit: Git.Commit = await Git.Commit.lookup(repo, oldLatestBranchCmd.commitSHAThatBranchPointsTo!);
			// await Git.Reset.reset(repo, commit, Git.Reset.TYPE.HARD, {});
			execSyncInRepo(`${options.gitCmd} reset --hard ${commit.sha()}`);

			/**
			 * go to the new "latest branch".
			 */
			const newTarget: string = newLatestBranchCmd.targets![0].replace(removeLocalRegex, "");
			execSyncInRepo(`${options.gitCmd} checkout ${newTarget}`);

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
				log({ before: linesOfEditedRebaseTodo[cmd.lineNumber] });
				linesOfEditedRebaseTodo[cmd.lineNumber] = words.join(" ");
				log({ after: linesOfEditedRebaseTodo[cmd.lineNumber] });
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

		const branchesWhoNeedLocalCheckout: BranchWhoNeedsLocalCheckout[] = [];

		for (const cmd of goodCommands) {
			if (cmd.rebaseKind === "regular") {
				regularRebaseTodoLines.push(cmd.fullLine);
			} else if (cmd.rebaseKind === "stacked") {
				if (cmd.commandName === "branch-end-new") {
					await createBranchForCommand(cmd as any); // TODO TS
				} else if (cmd.commandName === "branch-end-new-from-remote") {
					const b = parseBranchWhichNeedsLocalCheckout(cmd.targets!); // TODO TS NARROWER TYPES
					branchesWhoNeedLocalCheckout.push(b);
				}
			} else {
				assertNever(cmd);
			}
		}

		checkoutRemotePartialBranchesLocally(
			repo, //
			currentBranch,
			branchesWhoNeedLocalCheckout
		);

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

		log({
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
				options.gpgSign ? "--gpg-sign" : "",
			].join(" "),
			{
				env: {
					// https://git-scm.com/docs/git-rebase#Documentation/git-rebase.txt-sequenceeditor
					GIT_SEQUENCE_EDITOR: editorScriptPath,
				},
			}
		);

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
			log("regular git rebase process exited, but rebase is not finished yet - exiting outselves.");
			return;
		} else {
			log("regular git rebase process exited, and rebase is finished - continuing our execution.");
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

		const commitShaOfNewCurrentCommit = await getCurrentCommit();
		const rebaseChangedLocalHistory: boolean = commitShaOfCurrentCommit !== commitShaOfNewCurrentCommit;

		log({
			rebaseChangedLocalHistory, //
			commitShaOfOldCurrentCommit: commitShaOfCurrentCommit,
			commitShaOfNewCurrentCommit,
		});

		fs.unlinkSync(path.join(pathToStackedRebaseDirInsideDotGit, filenames.willNeedToApply));
		if (rebaseChangedLocalHistory) {
			markThatNeedsToApply(pathToStackedRebaseDirInsideDotGit);
		} else {
			// /**
			//  * TODO `unmarkThatNeedsToApply` (NOT the same as `markThatApplied`!)
			//  */
			// // unmarkThatNeedsToApply();
		}

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
				isMandatoryIfMarkedAsNeeded: false,
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				rootLevelCommandName: "--apply",
				gitCmd: options.gitCmd,
				autoApplyIfNeeded: options.autoApplyIfNeeded,
				config,
				initialBranch,
				currentBranch,
				askQuestion,
			});
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
}

export function parsePrereqs(specifiedOptions: SpecifiableGitStackedRebaseOptions) {
	const potentialRepoPath = specifiedOptions.gitDir || getDefaultResolvedOptions().gitDir;
	const gitCmd = specifiedOptions.gitCmd || getDefaultResolvedOptions().gitCmd;

	const execSyncInRepo = createExecSyncInRepo(potentialRepoPath);
	const repoRootDir: string = execSyncInRepo(`${gitCmd} rev-parse --show-toplevel`, { encoding: "utf-8", stdio: "pipe" }).toString().trim();
	
	return {
		repoRootDir,
		execSyncInRepo,
	}
}

export function referenceToOid(ref: Git.Reference): Promise<Git.Oid> {
	return ref.peel(Git.Object.TYPE.COMMIT).then((x) => x.id());
}

export async function createInitialEditTodoOfGitStackedRebase(
	repo: Git.Repository, //
	initialBranch: Git.Reference,
	currentBranch: Git.Reference,
	pathToRebaseTodoFile: string,
	autoSquash: boolean,
	repairFlag: boolean,
	askQuestion: AskQuestion,
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

	let commitsWithBranchBoundaries: CommitAndBranchBoundary[] = await getCommitsWithBranchBoundaries();

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

	if (autoSquash && repairFlag) {
		/**
		 * TODO: if autoSquash, but if explicit, instead of implicit via config,
		 * then throw
		 * 
		 * or just verify when parsing opts
		 */
		// throw new Termination(`\nincompatible options: autoSquash and repair.\n\n`);
	}

	if (autoSquash) {
		commitsWithBranchBoundaries = await autosquash(repo, commitsWithBranchBoundaries);
	}
	if (repairFlag) {
		await repair({ initialBranch, currentBranch, askQuestion, commitsWithBranchBoundaries, repo });
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
					...branchEnd.map((branch) => {
						/**
						 * TODO handle if multiple remotes exist & have the same branch
						 * in such a case, ask the user which remote to use
						 * (by default for all branches, and/or allow customizing for each one? tho rare)
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
						 *
						 * OR, do not do anything, because the user can edit the remote
						 * in the git-rebase-todo file when the editor opens.
						 *
						 * so maybe instead have some option for choosing the default remote,
						 * but otherwise everything's fine already.
						 *
						 * probably can respect the `checkout.defaultRemote` config var
						 * (see man git-checkout)
						 *
						 *
						 */
						if (branch.isRemote() || branch.name().startsWith("refs/remotes/")) {
							const wantedLocalBranchName: string = branch
								.name()
								.replace(removeRemoteRegex, "");

							const remoteName: string = branch.name().match(removeRemoteRegex)![1];

							return encodeCmdToLine({
								wantedLocalBranchName,
								remoteName,
								fullNameOfBranchWithRemote: getFullNameOfBranchWithRemote({ wantedLocalBranchName, remoteName })
							})
						} else {
							return `branch-end ${branch.name()}`;
						}
					}), //
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

export type BranchBoundaryWithCommits = {
	commits: [Git.Commit, RegularRebaseEitherCommandOrAlias][];
	branchEnds: Git.Reference[];
};

export function groupByBranchBoundaries(commitsWithBranchBoundaries: CommitAndBranchBoundary[]): BranchBoundaryWithCommits[] {
	const grouped: BranchBoundaryWithCommits[] = [];

	let commitsForBranch: BranchBoundaryWithCommits["commits"] = []

	for (let i = 0; i < commitsWithBranchBoundaries.length; i++) {
		const curr = commitsWithBranchBoundaries[i]
		
		if (curr.branchEnd?.length) {
			grouped.push({
				commits: commitsForBranch,
				branchEnds: curr.branchEnd,
			})

			commitsForBranch = []
		} else {
			commitsForBranch.push([curr.commit, curr.commitCommand])
		}
	}

	return grouped;
};

export type BranchWhoNeedsLocalCheckout = {
	wantedLocalBranchName: string; //
	remoteName: string;
	fullNameOfBranchWithRemote: string;
};

/**
 * expects targets from the format of "branch-end-new-from-remote"
 * TODO TS NARROWER TYPES (specific targets for each type of cmd)
 */
export function parseBranchWhichNeedsLocalCheckout(targets: NonNullable<Targets>): BranchWhoNeedsLocalCheckout {
	const wantedLocalBranchName: string = targets[0];
	const remoteAndRemoteBranchName: string = targets[1];
	const remoteName: string = remoteAndRemoteBranchName.split("/")[0];
	const fullNameOfBranchWithRemote: string = getFullNameOfBranchWithRemote({ fullNameOfBranchWithRemote: remoteAndRemoteBranchName });

	return {
		wantedLocalBranchName,
		remoteName,
		fullNameOfBranchWithRemote,
	}
}

function getFullNameOfBranchWithRemote(b: Pick<BranchWhoNeedsLocalCheckout, "fullNameOfBranchWithRemote"> | Pick<BranchWhoNeedsLocalCheckout, "wantedLocalBranchName" | "remoteName">): string {
	return (
		"fullNameOfBranchWithRemote" in b
			? b.fullNameOfBranchWithRemote
			: b.remoteName + "/" + b.wantedLocalBranchName
	);
}

// TODO RENAME
export function encodeCmdToLine(b: BranchWhoNeedsLocalCheckout) {
	return `branch-end-new-from-remote ${b.wantedLocalBranchName} ${b.fullNameOfBranchWithRemote}`;
}

// TODO RENAME
export function decodeLineToCmd(line: string): BranchWhoNeedsLocalCheckout {
	// TODO TS NARROWER TYPES
	const targets: NonNullable<Targets> = stackedRebaseCommands["branch-end-new-from-remote"].parseTargets(getParseTargetsCtxFromLine(line))!
	return parseBranchWhichNeedsLocalCheckout(targets);
}

function checkoutRemotePartialBranchesLocally(
	repo: Git.Repository, //
	currentBranch: Git.Reference,
	branchesWhoNeedLocalCheckout: BranchWhoNeedsLocalCheckout[]
): void {
	if (!branchesWhoNeedLocalCheckout.length) {
		return;
	}

	log({ branchesWhoNeedLocalCheckout });

	const execSyncInRepo = createExecSyncInRepo(repo.workdir());

	for (const b of branchesWhoNeedLocalCheckout) {
		const cmd = `git checkout -b ${b.wantedLocalBranchName} --track ${b.fullNameOfBranchWithRemote}`;
		execSyncInRepo(cmd);
	}

	/** go back */
	execSyncInRepo(`git checkout ${currentBranch.shorthand()}`);
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
		log({ results });
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

	const commitOfInitialBranch: Git.Oid = await referenceToOid(bb);
	const commitOfCurrentBranch: Git.Oid = await referenceToOid(currentBranch);

	// https://stackoverflow.com/a/1549155/9285308
	const latestCommitOfOursThatInitialBranchAlreadyHas: Git.Oid = await Git.Merge.base(
		repo, //
		commitOfInitialBranch,
		commitOfCurrentBranch
	);
	log({ mergeBase: latestCommitOfOursThatInitialBranchAlreadyHas.tostrS() });

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
	log("wrote editorScript");

	try {
		const execSyncInRepo = createExecSyncInRepo(repo.workdir());

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

		log("launching internal rebase with editorScript to create initial todo:\n%s", cmd);

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

	log("rebase -i exited successfully");

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

export const removeLocalRegex = /^refs\/heads\//;
export const removeRemoteRegex = /^refs\/remotes\/([^/]+)\//;

export function removeLocalAndRemoteRefPrefix(x: string): string {
	return x.replace(removeLocalRegex, "").replace(removeRemoteRegex, "");
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

export const helpMsg = `\

git-stacked-rebase <branch>

    0. usually <branch> should be a remote one, e.g. 'origin/master'.
    1. will perform the interactive stacked rebase from HEAD to <branch>,
    2. but will not apply the changes to partial branches until --apply is used.


git-stacked-rebase [-a|--apply]

    3. will apply the changes to partial branches,
    4. but will not push any partial branches to a remote until --push is used.


git-stacked-rebase [-p|--push -f|--force]

    5. will push partial branches with --force (and extra safety),
    6. but will not create any pull requests until --pull-request is used.


git-stacked-rebase [--pr|--pull-request]

    7. generates a list of URLs that can be used to create stacked PRs.
      (experimental, currently github-only.)


git-stacked-rebase --repair

      (experimental)
       finds partial branches that have diverged,
       checks if they can be automatically re-integrated back into the stack,
       and performs the repair if user accepts.



non-positional args:

  --autosquash, --no-autosquash

      handles "fixup!", "squash!" -prefixed commits
      just like --autosquash for a regular rebase does.

      can be enabled by default with the 'rebase.autosquash' option.


  --git-dir <path/to/git/dir/>

    makes git-stacked-rebase begin operating inside the specified directory.


  --debug

    prints the debug directory where logs are stored.


  -V|--version
  -h|--help


git-stacked-rebase __VERSION_REPLACEMENT_STR__ __BUILD_DATE_REPLACEMENT_STR__
`.replace(/\t/g, " ".repeat(4));

/**
 * the CLI
 */
export async function git_stacked_rebase(argv: Argv = process.argv.slice(2)): Promise<void> {
	try {
		const options: SpecifiableGitStackedRebaseOptions = parseArgv(argv);
		await gitStackedRebase(options);
		process.exit(0);
	} catch (e) {
		const isKnownError = e instanceof Termination;
		if (isKnownError) {
			if (e.exitCode === 0) {
				process.stdout.write(e.message);
			} else {
				process.stderr.write(e.message);
			}

			process.exit(e.exitCode);
		} else {
			const msg = e instanceof Error ? e.message : e;
			process.stderr.write(msg + "\n");

			process.exit(1);
		}
	}
}

export const parseArgs = (argvStr: string): SpecifiableGitStackedRebaseOptions => parseArgv(!argvStr?.trim() ? [] : argvStr.split(" "));

export function parseArgv(argv: Argv): SpecifiableGitStackedRebaseOptions {
	const argp = createArgParse(argv);

	if (argp.eatNonPositionals(["-h", "--help"]).length) {
		throw new Termination(helpMsg, 0);
	}

	if (argp.eatNonPositionals(["-V", "--version"]).length) {
		const msg = `git-stacked-rebase __VERSION_REPLACEMENT_STR__\n`;
		throw new Termination(msg, 0);
	}

	if (argp.eatNonPositionals(["--debug"]).length) {
		const msg = GSR_LOGDIR + "\n";
		throw new Termination(msg, 0);
	}

	const isAutoSquash: Maybe<boolean> = maybe(
		argp.eatNonPositionals(["--autosquash", "--no-autosquash"]),
		(xs) => last(xs).argName === "--autosquash",
		_ => undefined
	);

	/**
	 * TODO use value directly from git's `git --git-dir` if possible?
	 * (to get the default, probably)
	 */
	const gitDir: MaybeArg = maybe(
		argp.eatNonPositionalsWithValues(["--git-dir", "--gd"]),
		(xs) => last(xs).argVal,
		_ => undefined
	);

	const isPullRequest: Maybe<boolean> = argp.eatNonPositionals(["--pr", "--pull-request"]).length > 0

	const checkIsApply = (arg: MaybeArg): boolean => !!arg && ["--apply", "-a"].includes(arg);
	const checkIsContinue = (arg: MaybeArg): boolean => !!arg && ["--continue", "-c"].includes(arg);
	const checkIsPush = (arg: MaybeArg): boolean => !!arg && ["--push", "-p"].includes(arg);
	const checkIsBranchSequencer = (arg: MaybeArg): boolean =>
		!!arg && ["--branch-sequencer", "--bs", "-s"].includes(arg);
	const checkIsRepair = (arg: MaybeArg): boolean => !!arg && ["--repair"].includes(arg);

	const checkIsSecondArg = (arg: MaybeArg): boolean =>
		checkIsApply(arg) || checkIsContinue(arg) || checkIsPush(arg) || checkIsBranchSequencer(arg) || checkIsRepair(arg);

	let nameOfInitialBranch: MaybeArg = argp.eatNextArg();
	let second: MaybeArg;

	if (checkIsSecondArg(nameOfInitialBranch)) {
		second = nameOfInitialBranch;
		nameOfInitialBranch = undefined;
	} else {
		second = argp.eatNextArg();

		if (second && !checkIsSecondArg(second)) {
			const msg = `\nunknown second arg "${second}".\n\n`;
			throw new Termination(msg);
		}
	}

	const isApply: boolean = checkIsApply(second);
	const isContinue: boolean = checkIsContinue(second);
	const isPush: boolean = checkIsPush(second);
	const isBranchSequencer: boolean = checkIsBranchSequencer(second);
	const isRepair: boolean = checkIsRepair(second);

	let isForcePush: boolean = false;
	let branchSequencerExec: string | false = false;

	if (argp.hasMoreArgs() && (isPush || isBranchSequencer)) {
		const third = argp.eatNextArg() || "";

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
			if (execNames.includes(third) && argp.hasMoreArgs()) {
				const fourth = argp.eatNextArg();
				branchSequencerExec = fourth ? fourth : false;
			} else {
				const msg = `\n--branch-sequencer can only (for now) be followed by "${execNames.join("|")}".\n\n`;
				throw new Termination(msg);
			}
		}

		if (!isForcePush && !branchSequencerExec) {
			throw new Termination(`\nunknown 3rd arg "${third}".\n\n`);
		}
	}

	if (argv.length) {
		const msg = "\n" + bullets("\nerror - leftover arguments: ", argv, "  ") + "\n\n";
		throw new Termination(msg);
	}

	const options: SpecifiableGitStackedRebaseOptions = {
		initialBranch: nameOfInitialBranch,
		gitDir,
		autoSquash: isAutoSquash,
		apply: isApply,
		continue: isContinue,
		push: isPush,
		forcePush: isForcePush,
		branchSequencer: isBranchSequencer,
		branchSequencerExec,
		pullRequest: isPullRequest,
		repair: isRepair,
	};

	return options;
}

if (!module.parent) {
	git_stacked_rebase();
}
