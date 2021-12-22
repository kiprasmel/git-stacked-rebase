#!/usr/bin/env ts-node-dev

/* eslint-disable indent */
/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";
import fs from "fs";
import path from "path";
import assert from "assert";
import { bullets } from "nice-comment";

import { configKeys } from "./configKeys";
import { apply, applyIfNeedsToApply } from "./apply";
import { forcePush } from "./forcePush";

import { createExecSyncInRepo } from "./util/execSyncInRepo";
import { noop } from "./util/noop";
import { parseTodoOfStackedRebase } from "./parse-todo-of-stacked-rebase/parseTodoOfStackedRebase";
import { processWriteAndOrExit, fail, EitherExitFinal } from "./util/Exitable";
import { namesOfRebaseCommandsThatMakeRebaseExitToPause } from "./parse-todo-of-stacked-rebase/validator";

// console.log = () => {};

export type OptionsForGitStackedRebase = {
	repoPath: string;

	/**
	 * editor name, or a function that opens the file inside some editor.
	 */
	editor: string | ((ctx: { filePath: string }) => Promise<void>);

	/**
	 * for executing raw git commands
	 * that aren't natively supported by `nodegit` (libgit2)
	 */
	gitCmd: string;

	editTodo: boolean;
	viewTodoOnly: boolean;
	apply: boolean;
	push: boolean;
	forcePush: boolean;
};

export type SomeOptionsForGitStackedRebase = Partial<OptionsForGitStackedRebase>;

/**
 * TODO abstract into additional "getValueFromGitConfigLocalOrGlobal"
 * TODO v2 - lol nvm just use Git lmao. will need to extract `repoPath`
 */
const getDefaultOptions = (): OptionsForGitStackedRebase => ({
	repoPath: ".", //
	editor: process.env.EDITOR ?? "vi",
	gitCmd: process.env.GIT_CMD ?? "/usr/bin/env git",
	editTodo: false,
	viewTodoOnly: false,
	apply: false,
	push: false,
	forcePush: false,
});

function areOptionsIncompetible(
	options: OptionsForGitStackedRebase, //
	reasons: string[] = []
): boolean {
	if (options.viewTodoOnly) {
		if (options.editTodo) reasons.push("--edit-todo cannot be used together with --view-todo");
		if (options.apply) reasons.push("--apply cannot be used together with --view-todo");
		if (options.push) reasons.push("--apply cannot be used together with --push");
		if (options.forcePush) reasons.push("--apply cannot be used together with --push -f");
	}

	/**
	 * TODO HANDLE ALL CASES
	 */

	return reasons.length > 0;
}

export const gitStackedRebase = async (
	nameOfInitialBranch: string,
	specifiedOptions: SomeOptionsForGitStackedRebase = {}
): Promise<EitherExitFinal> => {
	try {
		const options: OptionsForGitStackedRebase = {
			...getDefaultOptions(), //
			...removeUndefinedProperties(specifiedOptions),
		};
		console.log({ options });

		const reasonsWhatWhyIncompatible: string[] = [];

		if (areOptionsIncompetible(options, reasonsWhatWhyIncompatible)) {
			return fail(
				"\n" +
					bullets(
						"error - incompatible options:", //
						reasonsWhatWhyIncompatible,
						"  "
					) +
					"\n\n"
			);
		}

		const repo = await Git.Repository.open(options.repoPath);
		const config = await Git.Config.openDefault();

		const configValues = {
			gpgSign: !!(await config.getBool(configKeys.gpgSign).catch(() => 0)),
			autoApplyIfNeeded: !!(await config.getBool(configKeys.autoApplyIfNeeded).catch(() => 0)),
		} as const;

		console.log({ configValues });

		// if (process.env.QUIT) return;

		const execSyncInRepo = createExecSyncInRepo(repo);

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

		if (options.apply) {
			return await apply({
				repo,
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit, //
				rootLevelCommandName: "--apply",
				gitCmd: options.gitCmd,
			});
		}

		const { neededToApply, userAllowedToApplyAndWeApplied, markThatNeedsToApply } = await applyIfNeedsToApply({
			repo,
			pathToStackedRebaseTodoFile,
			pathToStackedRebaseDirInsideDotGit, //
			rootLevelCommandName: "--apply",
			gitCmd: options.gitCmd,
			autoApplyIfNeeded: configValues.autoApplyIfNeeded,
			config,
		});

		if (neededToApply && !userAllowedToApplyAndWeApplied) {
			return;
		}

		if (options.push) {
			if (!options.forcePush) {
				return fail("\npush without --force will fail (since git rebase overrides history).\n\n");
			}

			return await forcePush({
				repo, //
				pathToStackedRebaseTodoFile,
				pathToStackedRebaseDirInsideDotGit,
				rootLevelCommandName: "--push --force",
				gitCmd: options.gitCmd,
			});
		}

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

			return;
		}

		const regularRebaseTodoLines: string[] = [];

		const [exit, goodCommands] = parseTodoOfStackedRebase(pathToStackedRebaseTodoFile);
		if (!goodCommands) return fail(exit);

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

		const getCurrentCommit = (): Promise<string> => repo.getHeadCommit().then((c) => c.sha());

		const commitShaOfCurrentCommit: string = await getCurrentCommit();

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
		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "orig-head"), commitShaOfCurrentCommit + "\n");

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "interactive"), "");

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "done"), "");

		fs.writeFileSync(
			path.join(pathToRegularRebaseDirInsideDotGit, "end"), //
			(regularRebaseTodoLines.length + 1).toString() + "\n"
		);

		fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "msgnum"), "1");

		if (configValues.gpgSign) {
			const gpgSignOpt = "-S" as const;
			fs.writeFileSync(path.join(pathToRegularRebaseDirInsideDotGit, "gpg_sign_opt"), gpgSignOpt);
		}

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
		execSyncInRepo(`${options.gitCmd} rebase --continue`);

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

		console.log("");
		console.log({
			rebaseChangedLocalHistory, //
			commitShaOfOldCurrentCommit: commitShaOfCurrentCommit,
			commitShaOfNewCurrentCommit,
		});
		console.log("");

		if (rebaseChangedLocalHistory) {
			markThatNeedsToApply();
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
			const canApply: boolean =
				/** part 1 */ fs.existsSync(path.join(pathToStackedRebaseDirInsideDotGit, "rewritten-list")) &&
				/** part 2 (incomplete?) */ !fs.existsSync(pathToRegularRebaseDirInsideDotGit) &&
				/** part 2 (complete?) (is this even needed?) */ goodCommands.every(
					(cmd) => !namesOfRebaseCommandsThatMakeRebaseExitToPause.includes(cmd.commandName)
				);

			if (canApply) {
				await applyIfNeedsToApply({
					repo,
					pathToStackedRebaseTodoFile,
					pathToStackedRebaseDirInsideDotGit, //
					rootLevelCommandName: "--apply",
					gitCmd: options.gitCmd,
					autoApplyIfNeeded: configValues.autoApplyIfNeeded,
					config,
				});
			}
		}

		return;
	} catch (e) {
		console.error(e);
		return fail(e);
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
							 *
							 * UPD: lol this will go off if e.g. we have 2 branches on the same commit,
							 * even tho one of them has nothing to do w/ this.
							 *
							 * but, ofc, we don't know which one should be ignored (yet?)
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

/**
 * the CLI
 */
export async function git_stacked_rebase(): Promise<EitherExitFinal> {
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
                                                                 2. will NOT execute the rebase,
                                                                 3. after viewing/editing, will remove the .tmp directory).

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

git-stacked-rebase <branch> [<repo_path=.> [--push -f]]         (will checkout each branch
                                                                 and will push --force.

                                                                 will NOT have any effect
                                                                 if --apply was not used yet).

git-stacked-rebase [...] -V|--version [...]
git-stacked-rebase [...] -h|--help    [...]


note: 'repo_path' will soon become optional (w/ a flag)
       when we fix the arg parsing.

git-stacked-rebase ${gitStackedRebaseVersionStr}
                ` as const;

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

	const nameOfInitialBranch: string | undefined = eatNextArg();
	if (!nameOfInitialBranch) return fail(helpMsg);

	const repoPath = eatNextArg();

	/**
	 * TODO: improve arg parsing, lmao
	 */
	const third = peakNextArg();

	const isEditTodo: boolean = !!third && ["--edit-todo", "-e"].includes(third as string);
	const isViewTodoOnly: boolean = !!third && ["--view-todo", "-v", "--view-only", "--view-todo-only"].includes(third);
	const isApply: boolean = !!third && ["--apply", "-a"].includes(third);
	const isPush: boolean = !!third && ["--push", "-p"].includes(third);

	let parsedThird = !third;
	if (third && !isEditTodo && !isViewTodoOnly && !isApply && !isPush) {
		parsedThird = false;
	} else {
		parsedThird = true;
		eatNextArg();
	}

	if (!parsedThird) {
		return fail("\nunrecognized 3rd option\n\n");
	}

	let isForcePush: boolean = false;
	if (isPush && peakNextArg()) {
		const fourth = eatNextArg() || "";

		isForcePush = ["--force", "-f"].includes(fourth);

		if (!isForcePush) {
			return fail(`\nunrecognized 4th option (after --push) (got "${fourth}")\n\n`);
		}
	}

	if (process.argv.length) {
		return fail(
			"" + //
				"\n" +
				bullets("\nerror - leftover arguments: ", process.argv, "  ") +
				"\n\n"
		);
	}

	const options: SomeOptionsForGitStackedRebase = {
		repoPath,
		editTodo: isEditTodo,
		viewTodoOnly: isViewTodoOnly,
		apply: isApply,
		push: isPush,
		forcePush: isForcePush,
	};

	// await
	return gitStackedRebase(nameOfInitialBranch, options); //
}

if (!module.parent) {
	git_stacked_rebase() //
		.then(processWriteAndOrExit);
}
