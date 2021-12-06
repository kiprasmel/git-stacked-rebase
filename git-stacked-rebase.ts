#!/usr/bin/env ts-node-dev

import Git from "nodegit";
import fs from "fs";
import path from "path";
import assert from "assert";
import { execSync } from "child_process";
import { pipestdio } from "pipestdio";
import { array } from "nice-comment";

import { noop } from "./util/noop";
import { parseTodoOfStackedRebase } from "./parse-todo-of-stacked-rebase/parseTodoOfStackedRebase";

// console.log = () => {};

export type OptionsForGitStackedRebase = {
	repoPath: string;
	/**
	 * editor name, or a function that opens the file inside some editor.
	 */
	editor: string | ((ctx: { filePath: string }) => void);
	editTodo: boolean;
	apply: boolean;
};

export type SomeOptionsForGitStackedRebase = Partial<OptionsForGitStackedRebase>;

const getDefaultOptions = (): OptionsForGitStackedRebase => ({
	repoPath: ".", //
	editor: process.env.EDITOR ?? "vi",
	editTodo: false,
	apply: false,
});

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

		const repo = await Git.Repository.open(options.repoPath);

		const dotGitDirPath: string = repo.path();
		const pathToStackedRebaseDirInsideDotGit = path.join(dotGitDirPath, "stacked-rebase");
		const pathToRegularRebaseDirInsideDotGit = path.join(dotGitDirPath, "rebase-merge");

		const pathToStackedRebaseTodoFile = path.join(pathToStackedRebaseDirInsideDotGit, "git-rebase-todo");
		const pathToRegularRebaseTodoFile = path.join(pathToRegularRebaseDirInsideDotGit, "git-rebase-todo");

		const goodCommands = parseTodoOfStackedRebase({
			pathToStackedRebaseTodoFile, //
			// pathToRegularRebaseTodoFile,
		});

		console.log({ goodCommands });

		if (options.apply) {
			const pathOfRewrittenList: string = path.join(repo.workdir(), ".git", "stacked-rebase", "rewritten-list");
			const rewrittenList: string = fs.readFileSync(pathOfRewrittenList, { encoding: "utf-8" });
			const rewrittenListLines: string[] = rewrittenList.split("\n").filter((line) => !!line);

			console.log({ rewrittenListLines });

			const newCommits: { newSHA: string; oldSHAs: string[] }[] = [];

			rewrittenListLines.map((line) => {
				const fromToSHA = line.split(" ");
				assert(
					fromToSHA.length === 2,
					"from and to SHAs, coming from rewritten-list, are written properly (1 space total)."
				);

				const [oldSHA, newSHA] = fromToSHA;

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

			// goodCommands[0].

			process.exit(0);
		}

		fs.mkdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });

		const initialBranch: Git.Reference | void = await Git.Branch.lookup(
			repo, //
			nameOfInitialBranch,
			Git.Branch.BRANCH.ALL
		);
		const currentBranch: Git.Reference = await repo.getCurrentBranch();

		if (!options.editTodo) {
			await createInitialEditTodoOfGitStackedRebase(
				repo, //
				initialBranch,
				pathToStackedRebaseTodoFile
			);
		}

		if (options.editor instanceof Function) {
			options.editor({ filePath: pathToStackedRebaseTodoFile });
		} else {
			execSync(`${options.editor} ${pathToStackedRebaseTodoFile}`, { ...pipestdio() });
		}

		const regularRebaseTodoLines: string[] = [];

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

		let isSafeToOverwrite: boolean;

		try {
			isSafeToOverwrite =
				!fs.statSync(pathOfPostRewriteScript).isFile() ||
				fs.readFileSync(pathOfPostRewriteScript, { encoding: "utf-8" }).includes(stackedRebaseNeedle);
		} catch (_e) {
			isSafeToOverwrite = true;
		}

		if (!isSafeToOverwrite) {
			for (let i = 1; ; i++) {
				const backupPath = `${pathOfPostRewriteScript}.backup.${i}`;

				let isSafe: boolean;
				try {
					isSafe = !fs.statSync(backupPath);
				} catch (_e) {
					isSafe = true;
				}

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
		execSync("/usr/bin/env git rebase --continue", { ...pipestdio(), cwd: repo.workdir() });

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

type KeyToFunctionMap = { [key: string | number | symbol]: Function };

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
	const branches: Git.Reference[] = (
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
	).filter((branch) => !!branch) as Git.Reference[];

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
	process.argv.splice(0, 2);

	const peakNextArg = (): string | undefined => process.argv[0];
	const eatNextArg = (): string | undefined => process.argv.shift();

	const eatNextArgOrExit = (): string | never =>
		eatNextArg() ||
		(process.stderr.write("\ngit-stacked-rebase <branch> [<repo_path=.> [-e|--edit-todo]] \n\n"), //
		process.exit(1));

	const nameOfInitialBranch: string = eatNextArgOrExit();

	const repoPath = eatNextArg();

	/**
	 * TODO: improve arg parsing, lmao
	 */
	const third = peakNextArg();

	const isEditTodo: boolean = !!third && ["--edit-todo", "-e"].includes(third as string);
	const isApply: boolean = !!third && ["--apply", "-a"].includes(third);

	let parsedThird = !third;
	if (!isEditTodo && !isApply) {
		parsedThird = false;
	} else {
		parsedThird = true;
		eatNextArg();
	}

	if (!parsedThird) {
		process.exit(1);
	}

	const options: SomeOptionsForGitStackedRebase = {
		repoPath,
		editTodo: isEditTodo,
		apply: isApply,
	};

	// await
	gitStackedRebase(nameOfInitialBranch, options);
}
