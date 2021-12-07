#!/usr/bin/env ts-node-dev

/* eslint-disable indent */
/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";
import fs from "fs";
import path from "path";
import assert from "assert";
import { execSync } from "child_process";
import { pipestdio } from "pipestdio";
import { array, bullets } from "nice-comment";

import { noop } from "./util/noop";
import { parseTodoOfStackedRebase } from "./parse-todo-of-stacked-rebase/parseTodoOfStackedRebase";
import { GoodCommand, stackedRebaseCommands } from "./parse-todo-of-stacked-rebase/validator";

// console.log = () => {};

export type OptionsForGitStackedRebase = {
	repoPath: string;
	/**
	 * editor name, or a function that opens the file inside some editor.
	 */
	editor: string | ((ctx: { filePath: string }) => Promise<void>);
	editTodo: boolean;
	viewTodoOnly: boolean;
	apply: boolean;
};

export type SomeOptionsForGitStackedRebase = Partial<OptionsForGitStackedRebase>;

const getDefaultOptions = (): OptionsForGitStackedRebase => ({
	repoPath: ".", //
	editor: process.env.EDITOR ?? "vi",
	editTodo: false,
	viewTodoOnly: false,
	apply: false,
});

function areOptionsIncompetible(
	options: OptionsForGitStackedRebase, //
	reasons: string[] = []
): boolean {
	if (options.viewTodoOnly) {
		if (options.editTodo) reasons.push("--edit-todo cannot be used together with --view-todo");
		if (options.apply) reasons.push("--apply cannot be used together with --view-todo");
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
			process.stderr.write(
				"" + //
					"\n" +
					bullets(
						"error - incompatible options:", //
						reasonsWhatWhyIncompatible,
						"  "
					) +
					"\n\n"
			);

			process.exit(1);
		}

		const repo = await Git.Repository.open(options.repoPath);

		/**
		 * always use this when doing git commands,
		 * because if user is in a different directory
		 * & is running git-stacked-rebase w/ a different path,
		 * then the git commands, without the repo.workdir() as cwd,
		 * would act on the current directory that the user is in (their cwd),
		 * as opposted to the actual target repo (would be very bad!)
		 */
		const execSyncInRepo = (command: string, extraOptions: Parameters<typeof execSync>[1] = {}) =>
			execSync(command, {
				...pipestdio(),
				...extraOptions,
				/**
				 * the `cwd` must be the last param here
				 * to avoid accidentally overwriting it.
				 * TODO TS - enforce
				 */
				cwd: repo.workdir(),
			});

		const dotGitDirPath: string = repo.path();

		const pathToRegularRebaseDirInsideDotGit: string = path.join(dotGitDirPath, "rebase-merge");
		const pathToRegularRebaseTodoFile = path.join(pathToRegularRebaseDirInsideDotGit, "git-rebase-todo");

		const createPathForStackedRebase = (withName: string): string => path.join(dotGitDirPath, withName); // "stacked-rebase"

		const __default__pathToStackedRebaseDirInsideDotGit: string = createPathForStackedRebase("stacked-rebase");
		const __default__pathToStackedRebaseTodoFile = path.join(
			__default__pathToStackedRebaseDirInsideDotGit,
			"git-rebase-todo"
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
				pathToStackedRebaseTodoFile: path.join(insideDir, "git-rebase-todo"),
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

		let goodCommands: GoodCommand[];

		const logGoodCmds = () => {
			console.log({
				goodCommands: goodCommands.map((c) => ({
					...c,
					targets: c.targets?.length === 1 ? c.targets[0] : array(c.targets ?? []),
				})),
			});

			console.log({
				goodCommands: goodCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
			});
		};

		if (options.apply) {
			if (!fs.existsSync(pathToStackedRebaseDirInsideDotGit)) {
				process.stderr.write("\n\nno stacked-rebase in progress? (nothing to --apply)\n\n");
				process.exit(1);
			}

			goodCommands = parseTodoOfStackedRebase({
				pathToStackedRebaseTodoFile,
			});
			logGoodCmds();

			const pathOfRewrittenList: string = path.join(repo.workdir(), ".git", "stacked-rebase", "rewritten-list");
			const rewrittenList: string = fs.readFileSync(pathOfRewrittenList, { encoding: "utf-8" });
			const rewrittenListLines: string[] = rewrittenList.split("\n").filter((line) => !!line);

			console.log({ rewrittenListLines });

			const newCommits: { newSHA: string; oldSHAs: string[] }[] = [];

			type OldCommit = { oldSHA: string; newSHA: string; changed: boolean };
			const oldCommits: OldCommit[] = [];

			rewrittenListLines.map((line) => {
				const fromToSHA = line.split(" ");
				assert(
					fromToSHA.length === 2,
					"from and to SHAs, coming from rewritten-list, are written properly (1 space total)."
				);

				const [oldSHA, newSHA] = fromToSHA;

				oldCommits.push({ oldSHA, newSHA, changed: oldSHA !== newSHA });

				const last = newCommits.length - 1;

				if (newCommits.length && newSHA === newCommits[last].newSHA) {
					newCommits[last].oldSHAs.push(oldSHA);
				} else {
					newCommits.push({
						newSHA,
						oldSHAs: [oldSHA],
					});
				}

				//
			});

			console.log({ newCommits: newCommits.map((c) => c.newSHA + ": " + array(c.oldSHAs)) });
			console.log({ oldCommits });

			/**
			 * match oldCommits & goodCommands
			 */
			const goodNewCommands: GoodCommand[] = [];

			goodNewCommands.push(goodCommands[0]);

			let lastNewCommit: OldCommit | null = null;

			let goodCommandMinIndex = 1;
			for (let i = 0; i < oldCommits.length; i++) {
				const oldCommit: OldCommit = oldCommits[i];

				const oldCommandAtIdx = goodCommands[goodCommandMinIndex];

				if (oldCommandAtIdx.commandName in stackedRebaseCommands) {
					goodNewCommands.push({
						...oldCommandAtIdx,
						commitSHAThatBranchPointsTo: (lastNewCommit as OldCommit | null)?.newSHA ?? null, // TODO TS
					} as any); // TODO TS
					goodCommandMinIndex++;
				}

				const goodOldCommand = goodCommands.find((cmd) => cmd.targets?.[0] === oldCommit.oldSHA);

				if (!goodOldCommand) {
					throw new Error("TODO: goodCommandOld not found");
				}

				const update = () => {
					if (goodOldCommand.commandName in stackedRebaseCommands) {
						// do not modify
						/** TODO FIXME CLEANUP: this actually never happens: (add `assert(false)`) */
						goodNewCommands.push(goodOldCommand);
						// goodCommandMinIndex++;
					} else {
						// goodNewCommands.push({ ...goodOldCommand, targets: [oldCommit.newSHA] /** TODO VERIFY */ });
						lastNewCommit = oldCommit;
						goodNewCommands.push({ ...goodOldCommand, targets: [oldCommit.newSHA] /** TODO VERIFY */ });
						goodCommandMinIndex++;
					}
				};

				if (goodOldCommand.index < goodCommandMinIndex) {
					// TODO VERIFY
					console.warn(
						`goodCommandOld.index (${goodOldCommand.index}) < goodCommandMinIndex (${goodCommandMinIndex}), continue'ing.`
					);

					// goodCommandMinIndex++;

					continue;
				} else if (goodOldCommand.index === goodCommandMinIndex) {
					// perfect?
					// TODO VERIFY
					console.info(`index match`);

					update();
				} else {
					// jump?
					// TODO VERIFY
					console.warn(`jump, continue'ing`);

					// update(); // TODO VERIFY
					continue;
				}

				//
			}

			goodNewCommands.push(goodCommands[goodCommands.length - 1]);

			// console.log({ goodNewCommands });
			console.log({
				len: goodCommands.length,
				goodCommands: goodCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
			});

			console.log({
				len: goodNewCommands.length,
				goodNewCommands: goodNewCommands.map((c) => c.commandOrAliasName + ": " + c.targets?.join(", ") + "."),
			});

			const stackedRebaseCommandsOld = goodCommands.filter((cmd) => cmd.commandName in stackedRebaseCommands);
			const stackedRebaseCommandsNew = goodNewCommands
				.map((cmd, i) =>
					cmd.commandName in stackedRebaseCommands
						? {
								...cmd,
								commitSHAThatBranchPointsTo: i > 0 ? goodNewCommands[i - 1].targets?.[0] ?? null : null,
						  }
						: false
				)
				.filter((cmd) => !!cmd);

			assert(stackedRebaseCommandsOld.length === stackedRebaseCommandsNew.length);

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

			const checkout = async (cmds: GoodCommand[]): Promise<void> => {
				console.log("checkout", cmds.length);
				if (!cmds.length) {
					return;
				}

				const goNext = () =>
					new Promise<void>((r) => {
						setTimeout(() => {
							checkout(cmds.slice(1)).then(() => r());
						}, 100);
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

				// await Git.Checkout.tree(repo, targetBranch as any); // TODO TS FIXME
				execSyncInRepo(`git checkout ${targetBranch}`); // f this

				const commit: Git.Commit = await Git.Commit.lookup(repo, targetCommitSHA);

				console.log("will reset because", cmd.commandOrAliasName, "to commit", commit.summary(), commit.sha());

				/**
				 * meaning we're on the latest branch
				 */
				const isFinalCheckout: boolean = cmds.length === 1;

				console.log({ isFinalCheckout });

				if (!isFinalCheckout) {
					await Git.Reset.reset(repo, commit, Git.Reset.TYPE.HARD, {});

					// if (previousTargetBranchName) {
					// execSyncInRepo(`/usr/bin/env git rebase ${previousTargetBranchName}`);
					// }
				}

				return goNext();

				// for (const cmd of stackedRebaseCommandsNew) {
				// 	};
			};

			await checkout(stackedRebaseCommandsNew.slice(1) as any); // TODO TS

			const backupPath: string = pathToStackedRebaseDirInsideDotGit + ".previous";

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

			process.exit(0);
		} // options.apply

		fs.mkdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });

		const initialBranch: Git.Reference | void = await Git.Branch.lookup(
			repo, //
			nameOfInitialBranch,
			Git.Branch.BRANCH.ALL
		);
		const currentBranch: Git.Reference = await repo.getCurrentBranch();

		const wasRegularRebaseInProgress: boolean = fs.existsSync(pathToRegularRebaseDirInsideDotGit);
		// const

		console.log({ wasRegularRebaseInProgress });

		if (!wasRegularRebaseInProgress) {
			await createInitialEditTodoOfGitStackedRebase(
				repo, //
				initialBranch,
				// __default__pathToStackedRebaseTodoFile
				pathToStackedRebaseTodoFile
			);
		}

		if (!wasRegularRebaseInProgress || options.editTodo || options.viewTodoOnly) {
			if (options.editor instanceof Function) {
				await options.editor({ filePath: pathToStackedRebaseTodoFile });
			} else {
				execSyncInRepo(`${options.editor} ${pathToStackedRebaseTodoFile}`);
			}
		}

		if (options.viewTodoOnly) {
			fs.rmdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });

			const dirname = path.basename(pathToStackedRebaseDirInsideDotGit);

			process.stdout.write(`removed ${dirname}/\n`);
			process.exit(0);
		}

		const regularRebaseTodoLines: string[] = [];

		goodCommands = parseTodoOfStackedRebase({
			pathToStackedRebaseTodoFile,
		});

		goodCommands.map((cmd) => {
			if (cmd.rebaseKind === "regular") {
				regularRebaseTodoLines.push(cmd.fullLine);
			}
		});

		/**
		 * libgit2's git rebase is sadly not very powerful
		 * and quite outdated...
		 * (checked C version too - same story).
		 *
		 * thus, looks like we'll have to reverse-engineer git itself.
		 *
		 */

		/** BEGIN LIBGIT2 REBASE ATTEMPT */

		// const annotatedCommitOfCurrentBranch: Git.AnnotatedCommit = await Git.AnnotatedCommit.fromRef(
		// 	repo,
		// 	currentBranch
		// );
		// const annotatedCommitOfInitialBranch: Git.AnnotatedCommit = await Git.AnnotatedCommit.fromRef(
		// 	repo,
		// 	initialBranch
		// );

		// const rebase: Git.Rebase = await Git.Rebase.init(
		// 	repo, //
		// 	annotatedCommitOfCurrentBranch,
		// 	annotatedCommitOfInitialBranch,
		// 	annotatedCommitOfInitialBranch // TODO VERIFY
		// 	// (null as unknown) as Git.AnnotatedCommit // TODO TS
		// 	// Git.Rebase.initOptions()
		// );

		// const currentOp: number = rebase.operationCurrent();
		// console.log({ rebase, currentOp });

		/** END LIBGIT2 REBASE ATTEMPT */

		const regularRebaseTodo: string = regularRebaseTodoLines.join("\n") + "\n";

		console.log({
			regularRebaseTodo,
			pathToRegularRebaseTodoFile,
		});

		fs.mkdirSync(pathToRegularRebaseDirInsideDotGit, { recursive: true });

		fs.writeFileSync(pathToRegularRebaseTodoFile, regularRebaseTodo);
		fs.writeFileSync(pathToRegularRebaseTodoFile + ".backup", regularRebaseTodo);

		/**
		 * writing the rebase todo is not enough.
		 * follow https://github.com/git/git/blob/abe6bb3905392d5eb6b01fa6e54d7e784e0522aa/sequencer.c#L53-L170
		 */

		// (await initialBranch.peel(Git.Object.TYPE.COMMIT))
		const commitShaOfInitialBranch: string = (await (await getCommitOfBranch(repo, initialBranch)).sha()) + "\n";

		const commitShaOfCurrentCommit: string = (await (await repo.getHeadCommit()).sha()) + "\n";

		console.log({ commitShaOfInitialBranch });

		await repo.checkoutRef(initialBranch);
		// repo.rebaseBranches()

		// const headName: string = (await (await repo.getHeadCommit()).sha()) + "\n";
		// const headName: string = initialBranch.name() + "\n";
		const headName: string = currentBranch.name() + "\n";
		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "head-name"), headName);

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "orig-name"), commitShaOfInitialBranch);

		fs.writeFileSync(
			path.join(pathToRegularRebaseDirInsideDotGit, "onto"), //
			commitShaOfInitialBranch
		);

		fs.writeFileSync(
			path.join(pathToRegularRebaseDirInsideDotGit, "onto"), //
			commitShaOfInitialBranch
		);
		/**
		 * TODO - is this even needed? seems only a nodegit thing
		 */
		fs.writeFileSync(
			path.join(pathToRegularRebaseDirInsideDotGit, "onto_name"), //
			initialBranch.name() + "\n"
		);
		fs.writeFileSync(
			path.join(pathToRegularRebaseDirInsideDotGit, "cmt.1"), //
			commitShaOfInitialBranch
		);

		fs.writeFileSync(
			// path.join(dotGitDirPath, "HEAD"), //
			path.join(pathToRegularRebaseDirInsideDotGit, "head"),
			commitShaOfInitialBranch
		);

		// fs.writeFileSync(path.join(dotGitDirPath, "ORIG_HEAD"), commitShaOfInitialBranch);
		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "orig-head"), commitShaOfCurrentCommit);

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "interactive"), "");

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "done"), "");

		fs.writeFileSync(
			path.join(pathToRegularRebaseDirInsideDotGit, "end"), //
			(regularRebaseTodoLines.length + 1).toString() + "\n"
		);

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "msgnum"), "1");

		/**
		 * end rebase initial setup.
		 * begin setup to handle post-rebase shenanigans.
		 */

		/**
		 * goal is to save the rewritten-list file,
		 * which git deletes once the rebase is done,
		 *
		 * and when git-stacked-rebase gets called again
		 * with `--apply` or whatever - to recover the commits.
		 *
		 */
		const stackedRebaseNeedle = "__ADDED_BY_GIT_STACKED_REBASE";
		const version = "V0";

		const postRewriteScript: string = `\
#!/usr/bin/env bash

# DO NOT EDIT THIS FILE MANUALLY
# AUTO-GENERATED BY GIT-STACKED-REBASE

# todo - add a way to call another script from here
# so that the user can still configure it
# (and/or allow extending their own script 
# to call ours)

#${stackedRebaseNeedle}__${version}

# works when git calls it.
# supposed to be placed in .git/hooks/ as post-rewrite


#printf "post-rewrite $REPO_ROOT; \\n"
#
#ls -la .git/rebase-merge
#
#command -v notify-send &>/dev/null && {
#	notify-send "post-rewrite"
#}

#DIR="\${BASH_SOURCE[0]}"
#REBASE_MERGE_DIR="$(realpath "$DIR/../rebase-merge")"
REBASE_MERGE_DIR="$(pwd)/.git/rebase-merge"
REWRITTEN_LIST_FILE_PATH="$REBASE_MERGE_DIR/rewritten-list"

STACKED_REBASE_DIR="$(pwd)/.git/stacked-rebase"
REWRITTEN_LIST_BACKUP_FILE_PATH="$STACKED_REBASE_DIR/rewritten-list"

#echo "REBASE_MERGE_DIR $REBASE_MERGE_DIR; STACKED_REBASE_DIR $STACKED_REBASE_DIR;"

cat "$REWRITTEN_LIST_FILE_PATH" > "$REWRITTEN_LIST_BACKUP_FILE_PATH"

		`;

		/**
		 * TODO: safety measures to make sure one does not already have
		 * their own custom post-rewrite script lol
		 */
		const hooksDir: string = path.join(dotGitDirPath, "hooks");
		const pathOfPostRewriteScript: string = path.join(hooksDir, "post-rewrite");

		fs.mkdirSync(hooksDir, { recursive: true });

		const isSafeToOverwrite: boolean =
			!fs.existsSync(pathOfPostRewriteScript) || //
			fs.readFileSync(pathOfPostRewriteScript, { encoding: "utf-8" }).includes(stackedRebaseNeedle);

		if (!isSafeToOverwrite) {
			for (let i = 1; ; i++) {
				const backupPath = `${pathOfPostRewriteScript}.backup.${i}`;

				const isSafe: boolean = !fs.existsSync(backupPath);

				if (isSafe) {
					if (i > 1) {
						process.stdout.write(
							`\nwarning - multiple backups (${i - 1}) of post-rewrite hook exist, creating ${i -
								1} + 1.\n\n`
						);
					}

					fs.copyFileSync(pathOfPostRewriteScript, backupPath);

					break;
				}
			}
		}

		fs.writeFileSync(pathOfPostRewriteScript, postRewriteScript);
		fs.chmodSync(pathOfPostRewriteScript, "755");
		if (!isSafeToOverwrite) {
			process.stdout.write("\nwarning - overwrote post-rewrite script in .git/hooks/, saved backup.\n\n");
		}

		/**
		 * too bad libgit2 is limited. oh well, i've seen worse.
		 *
		 * this passes it off to the user.
		 *
		 * they'll come back to us once they're done,
		 * with --apply or whatever.
		 *
		 */
		execSyncInRepo("/usr/bin/env git rebase --continue");

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
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
};

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
	pathToRebaseTodoFile: string
): Promise<void> {
	// .catch(logErr);

	// if (!bb) {
	// 	console.error();
	// 	return;
	// }

	const commitsWithBranchBoundaries: CommitAndBranchBoundary[] = (
		await getWantedCommitsWithBranchBoundaries(
			repo, //
			initialBranch
		)
	).reverse();

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
	console.log({ commitsWithBranchBoundaries });

	const rebaseTodo = commitsWithBranchBoundaries
		.map(({ commit, branchEnd }, i) => {
			if (i === 0) {
				assert(!!branchEnd, "very first commit has a branch.");

				// return [];
				return [
					// `pick ${commit.sha()} ${commit.summary()}`,
					/**
					 * TODO refs/REMOTES/* instead of refs/HEADS/*
					 */
					`branch-end-initial ${branchEnd.name()}`, //
				];
			}

			if (i === commitsWithBranchBoundaries.length - 1) {
				assert(!!branchEnd, "very last commit has a branch.");

				return [
					`pick ${commit.sha()} ${commit.summary()}`,
					`branch-end-last ${branchEnd.name()}`, //
				];
			}

			if (branchEnd) {
				return [
					`pick ${commit.sha()} ${commit.summary()}`,
					`branch-end ${branchEnd.name()}`, //
				];
			}

			return [
				`pick ${commit.sha()} ${commit.summary()}`, //
			];
		})
		.filter((xs) => xs.length)
		.flat();

	console.log({ rebaseTodo });

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

type CommitAndBranchBoundary = {
	commit: Git.Commit;
	branchEnd: Git.Reference | null;
};

async function getWantedCommitsWithBranchBoundaries(
	repo: Git.Repository, //
	/** beginningBranch */
	bb: Git.Reference
): Promise<CommitAndBranchBoundary[]> {
	const fixBranchName = (name: string): string =>
		name
			// .replace(beginningBranchName.includes(name) ? "" : "refs/heads/", "") //
			.replace("refs/heads/", ""); //
	// TODO: consider
	// .replace(name.includes(beginningBranchName) ? "refs/remotes/" : "", "");

	const refs = await Git.Reference.list(repo);
	const branches: Git.Reference[] = ((
		await Promise.all(
			refs.map(
				(ref: string): Promise<Git.Reference | undefined> =>
					Git.Branch.lookup(
						repo, //
						fixBranchName(ref),
						Git.Branch.BRANCH.ALL /** filtering seems broken, all act the same as ALL */
					).catch(() => undefined)
			)
		)
	).filter((branch) => !!branch) as Git.Reference[]).map(
		(branch) => (!branch.cmp(bb) ? bb : branch) //
	);

	console.log({ refs, branches: branches.map((b) => fixBranchName(b?.name())) });

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

	const commitOfBB: Git.Oid = (await bb.peel(Git.Object.TYPE.COMMIT)).id();

	const wantedCommits: Git.Commit[] = await getCommitHistoryUntilIncl(repo, commitOfBB);

	console.log({
		wantedCommits: wantedCommits.map((c) =>
			[
				c.sha(), //
				c.summary(),
				c.parentcount(),
			].join(" ")
		),
	});

	const commitsByBranch = Object.fromEntries<Git.Commit | null>(branches.map((b) => [b.name(), null]));

	await Promise.all(
		branches
			.map(async (branch) => {
				const commitOfBranch = await branch.peel(Git.Object.TYPE.COMMIT);
				// console.log({ branch: branch.name(), commitOfBranch: commitOfBranch.id().tostrS() });

				wantedCommits.map((commit) => {
					const matches = !commitOfBranch.id().cmp(commit.id());

					(commit as any).meta = (commit as any).meta || { branchEnd: null };

					if (matches) {
						// // console.log({
						// // 	matches, //
						// // 	commitOfBranch: commitOfBranch.id().tostrS(),
						// // 	commit: commit.id().tostrS(),
						// // });
						// commitsByBranch[branch.name()].push(commit);

						// if (commitsByBranch[branch.name()]) {
						if ((commit as any).meta.branchEnd) {
							console.error({
								commit: commit?.summary(),
								branchOld: (commit as any).meta.branchEnd.name(),
								branchNew: branch.name(),
							});
							/**
							 * TODO FIXME BFS (starting from beginningBranch? since child only has 1 parent?)
							 */
							throw new Error(
								"2 (or more) branches for the same commit, both in the same path - cannot continue (until explicit branch specifying is implemented)."
							);
						}

						commitsByBranch[branch.name()] = commit;
						(commit as any).meta.branchEnd = branch;

						// // return {
						// // 	commit,
						// // 	branch,
						// // };
					}
					// else
					// 	return {
					// 		commit,
					// 		branch: null,
					// 	};
				});
			})
			.flat()
	);

	const wantedCommitByBranch = Object.fromEntries(
		// Object.entries(commitsByBranch).filter(([_branchName, commits]) => commits.length)
		Object.entries(commitsByBranch).filter(([_, commit]) => !!commit)
	);
	// const wantedCommitsByBranch = commitsByBranch;

	// Object.entries(wantedCommitsByBranch).forEach(([_, commits]) => {
	// 	assert(commits.length === 1);
	// });

	const wantedCommitByBranchStr = Object.fromEntries(
		Object.entries(wantedCommitByBranch).map(([branchName, commit]) => [
			branchName, //
			// commits.map((c) => c.summary()),
			commit?.sha(),
			// commits.map((c) => c.sha()),
			// ].join("  \n")
		])
	);

	console.log({
		wantedCommitByBranch: wantedCommitByBranchStr,
		// wantedCommitsByBranch.map(([branchName, commits]) => [
		// 	branchName,
		// 	commits.map((c) => c),
		// ]),
		wantedBranchByCommit: swapKeyVal(wantedCommitByBranch),
	});

	console.log({
		wantedCommits: wantedCommits.map(
			(c) =>
				c.sha() + //
				" " +
				((c as any).meta?.branchEnd as Git.Reference)?.name()
		),
	});

	const commitsAndBranchBoundaries: CommitAndBranchBoundary[] = wantedCommits.map((c) => ({
		commit: c,
		branchEnd: (c as any).meta?.branchEnd as Git.Reference | null,
	}));

	return commitsAndBranchBoundaries;
}

function swapKeyVal(obj: {}) {
	return Object.entries(obj) //
		.reduce(
			(
				acc, //
				[k, v]
			) => Object.assign(acc, { [(v as unknown) as string]: k }),
			{}
		);
}

noop(getCommitOfBranch);
async function getCommitOfBranch(repo: Git.Repository, branchReference: Git.Reference) {
	const branchOid: Git.Oid = await (await branchReference.peel(Git.Object.TYPE.COMMIT)).id();
	return await Git.Commit.lookup(repo, branchOid);
}

if (!module.parent) {
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

git-stacked-rebase <branch> [<repo_path=.>                      (~~if first invocation,~~ acts the same as --edit-todo).
                                                                    TODO FIXME:
                                                                    --edit-todo should not re-generate the todo
                                                                    (only if no rebase in progress? seems bad for the mental model)
                                                                    (perhaps --apply should not exist).

git-stacked-rebase <branch> [<repo_path=.> [-e|--edit-todo]]    (1. will edit the todo & will execute the rebase
                                                                    (in the latest branch),
                                                                 2. but will not apply the changes to partial branches
                                                                    until --apply is used).

git-stacked-rebase <branch> [<repo_path=.> [-v|--view-todo|--view-only]]
                                                                (1. will make git-stacked-rebase work inside a separate, .tmp directory,
                                                                    to allow viewing/editing (w/o affecting the actual todo
                                                                    nor any subsequent runs that might happen later),
                                                                 2. will NOT execute the rebase.
                                                                 3. after viewing/editing, will remove the .tmp directory

                                                                 this is safe because the decision of using the .tmp directory or not
                                                                 is decided purely by this option,
                                                                 and **it's impossible to have more options** that would 
                                                                 have side effects for the git repository
                                                                 (because git-stacked-rebase would be working in the same .tmp directory).

                                                                 i.e. if --view-todo is specified, then another option,
                                                                 such as --edit-todo, or --apply, cannot be specified,
                                                                 because all of these options are positional
                                                                 & are the 3rd argument.
                                                                 additionally, gitStackedRebase checks for these incompatible options
                                                                 in the library code as well (TODO check all incompatible options)
                                                                 ).


git-stacked-rebase <branch> [<repo_path=.> [-a|--apply]]        (will apply the changes
                                                                 from the latest branch
                                                                 to all partial branches
                                                                 (currently, using 'git reset --hard')).
git-stacked-rebase [...] -V|--version [...]
git-stacked-rebase [...] -h|--help    [...]


note: 'repo_path' will soon become optional (w/ a flag)
       when we fix the arg parsing.

git-stacked-rebase ${gitStackedRebaseVersionStr}
                ` as const;

	if (process.argv.some((arg) => ["-h", "--help"].includes(arg))) {
		process.stdout.write(helpMsg);
		process.exit(0);
	}

	if (process.argv.some((arg) => ["-V", "--version"].includes(arg))) {
		process.stdout.write(`\ngit-stacked-rebase ${gitStackedRebaseVersionStr}\n\n`);
		process.exit(0);
	}

	process.argv.splice(0, 2);

	const peakNextArg = (): string | undefined => process.argv[0];
	const eatNextArg = (): string | undefined => process.argv.shift();

	const eatNextArgOrExit = (): string | never =>
		eatNextArg() ||
		(process.stderr.write(helpMsg), //
		process.exit(1));

	const nameOfInitialBranch: string = eatNextArgOrExit();

	const repoPath = eatNextArg();

	/**
	 * TODO: improve arg parsing, lmao
	 */
	const third = peakNextArg();

	const isEditTodo: boolean = !!third && ["--edit-todo", "-e"].includes(third as string);
	const isViewTodoOnly: boolean = !!third && ["--view-todo", "-v", "--view-only", "--view-todo-only"].includes(third);
	const isApply: boolean = !!third && ["--apply", "-a"].includes(third);

	let parsedThird = !third;
	if (third && !isEditTodo && !isViewTodoOnly && !isApply) {
		parsedThird = false;
	} else {
		parsedThird = true;
		eatNextArg();
	}

	if (!parsedThird) {
		process.stdout.write("\nunrecognized 3rd option\n\n");
		process.exit(1);
	}

	if (process.argv.length) {
		process.stderr.write(
			"" + //
				"\n" +
				bullets("\nerror - leftover arguments: ", process.argv, "  ") +
				"\n\n"
		);
		process.exit(1);
	}

	const options: SomeOptionsForGitStackedRebase = {
		repoPath,
		editTodo: isEditTodo,
		viewTodoOnly: isViewTodoOnly,
		apply: isApply,
	};

	// await
	gitStackedRebase(nameOfInitialBranch, options);
}
