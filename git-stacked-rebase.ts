#!/usr/bin/env ts-node-dev

import Git from "nodegit";
// import assert from "assert";
import path from "path";

export const noop = (..._xs: any[]): void => {
	//
};

export type GitStackedRebaseOptions = {
	// begginingBranchName: string;
};

export const logErr = (err: any) => (console.error(err), err);

export const gitStackedRebase = async (
	beginningBranchName: string = "origin/fork" // TODO
	// _options: GitStackedRebaseOptions = {}
) => {
	try {
		// const repo = await Git.Repository.open("."); // TODO
		const repo = await Git.Repository.open(path.join(process.env.HOME!, "forkprojects", "codeshiftcommunity")); // TODO FIXME - only testing

		const beginningBranch: Git.Reference | void = await Git.Branch.lookup(
			repo, //
			beginningBranchName,
			Git.Branch.BRANCH.ALL
		); //
		// .catch(logErr);

		// if (!bb) {
		// 	console.error();
		// 	return;
		// }

		const commitsWithBranchBoundaries: CommitAndBranchBoundary[] = await getWantedCommitsWithBranchBoundaries(
			repo, //
			beginningBranch
		);
		noop(commitsWithBranchBoundaries);
		// console.log({ commitsWithBranchBoundaries });

		// const rebase = await Git.Rebase.init()
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
};

export async function getCommitHistory(
	repo: Git.Repository, //
	onCommit: (
		commit: Git.Commit, //
		collectAndStop: () => void
	) => void = () => {
		//
	}
): Promise<Git.Commit[]> {
	const commit: Git.Commit = await repo.getHeadCommit();
	const commitEmitter = commit.history();

	const collectedCommits: Git.Commit[] = [];

	commitEmitter.start();

	return new Promise((resolve, reject) => {
		commitEmitter.on("commit", (c) => {
			collectedCommits.push(c);
			onCommit(c, () => commitEmitter.emit("end", collectedCommits));
		});
		commitEmitter.on("end", (cs) => {
			resolve(cs);
		});
		commitEmitter.on("error", (c) => {
			console.error("error", { c });
			reject(c);
		});
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

if (!module.parent) {
	gitStackedRebase();
}
