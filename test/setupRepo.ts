/* eslint-disable @typescript-eslint/camelcase */

import fs from "fs";
import assert from "assert";

import Git from "nodegit";

import { gitStackedRebase } from "../git-stacked-rebase";
import { defaultGitCmd, SomeOptionsForGitStackedRebase } from "../options";
import { configKeys } from "../config";
import { humanOpAppendLineAfterNthCommit } from "../humanOp";

import { createExecSyncInRepo } from "../util/execSyncInRepo";
import { editor__internal, getGitConfig__internal } from "../internal";

import { createTmpdir } from "./util/tmpdir";

type Opts = {
	blockWithRead?: boolean;
	commitCount?: number;
} & Omit<SetupRepoOpts, "bare">;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRepo({
	blockWithRead = false, //
	commitCount = 12,
	...rest
}: Opts = {}) {
	const {
		repo, //
		config,
		sig,
		dir,
		execSyncInRepo,
		common,
	} = await setupRepoBase({ ...rest, bare: 0 });

	const inicialCommitId = "Initial commit (from setupRepo)";
	const initialCommit: Git.Oid = await fs.promises
		.writeFile(inicialCommitId, inicialCommitId) //
		.then(() => repo.createCommitOnHead([inicialCommitId], sig, sig, inicialCommitId));

	console.log("initial commit %s", initialCommit.tostrS());

	const commitOidsInInitial: Git.Oid[] = [];
	const initialBranchRef: Git.Reference = await appendCommitsTo(commitOidsInInitial, 3, repo, sig);

	const initialBranch: string = initialBranchRef.shorthand();
	const commitsInInitial: string[] = commitOidsInInitial.map((oid) => oid.tostrS());

	const latestStackedBranchName = "stack-latest";
	const headCommit: Git.Commit = await repo.getHeadCommit();
	const createBranchCmd = `${defaultGitCmd} checkout -b ${latestStackedBranchName} ${headCommit}`;
	execSyncInRepo(createBranchCmd);

	const read = (): void => (blockWithRead ? void execSyncInRepo("read") : void 0);

	read();

	const commitOidsInLatestStacked: Git.Oid[] = [];
	await appendCommitsTo(commitOidsInLatestStacked, commitCount, repo, sig);

	const commitsInLatest: string[] = commitOidsInLatestStacked.map((oid) => oid.tostrS());

	const newPartialBranches = [
		["partial-1", 4],
		["partial-2", 6],
		["partial-3", 8],
	] as const;

	console.log("launching 0th rebase to create partial branches");
	await gitStackedRebase(initialBranch, {
		...common,
		[editor__internal]: ({ filePath }) => {
			console.log("filePath %s", filePath);

			for (const [newPartial, nthCommit] of newPartialBranches) {
				humanOpAppendLineAfterNthCommit(`branch-end-new ${newPartial}`, {
					filePath,
					commitSHA: commitOidsInLatestStacked[nthCommit].tostrS(),
				});
			}

			console.log("finished editor");

			read();
		},
	});

	// console.log("looking up branches to make sure they were created successfully");
	read();
	for (const [newPartial] of newPartialBranches) {
		/**
		 * will throw if branch does not exist
		 * TODO "properly" expect to not throw
		 */
		await Git.Branch.lookup(repo, newPartial, Git.Branch.BRANCH.LOCAL);
	}

	return {
		repo,
		config,
		sig,
		dir,
		common,

		initialBranchRef,
		initialBranch,
		commitOidsInInitial,
		commitsInInitial,

		latestStackedBranchName,
		commitOidsInLatestStacked,
		commitsInLatest,

		newPartialBranches,

		execSyncInRepo,
		read,
	} as const;
}

export type InitRepoCtx = {
	Git: typeof Git;
	dir: string;
	bare: number;
};

export type SetupRepoOpts = {
	tmpdir?: boolean;
	bare?: number;
	initRepo?: (ctx: InitRepoCtx) => Promise<Git.Repository>;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRepoBase({
	tmpdir = true, //
	bare = 0,
	initRepo = (ctx) => ctx.Git.Repository.init(ctx.dir, ctx.bare),
}: SetupRepoOpts = {}) {
	const dir: string = createTmpdir(tmpdir, !!bare);

	/**
	 * TODO make concurrent-safe (lol)
	 */
	process.chdir(dir);
	console.log("chdir to tmpdir %s", dir);

	const repo: Git.Repository = await initRepo({ Git, dir, bare });

	const config: Git.Config = await repo.config();

	await config.setBool(configKeys.autoApplyIfNeeded, Git.Config.MAP.FALSE);
	await config.setString("user.email", "tester@test.com");
	await config.setString("user.name", "tester");

	/**
	 * gpg signing in tests not possible i believe,
	 * at least wasn't working.
	 */
	await config.setBool(configKeys.gpgSign, Git.Config.MAP.FALSE);

	const sig: Git.Signature = await Git.Signature.default(repo);
	console.log("sig %s", sig);

	const execSyncInRepo = createExecSyncInRepo(repo);

	/**
	 * common options to GitStackedRebase,
	 * esp. for running tests
	 * (consumes the provided config, etc)
	 */
	const common: SomeOptionsForGitStackedRebase = {
		gitDir: dir,
		[getGitConfig__internal]: () => config,
	} as const;

	return {
		dir,
		repo,
		config,
		sig,
		execSyncInRepo,
		common,
	} as const;
}

export async function appendCommitsTo(
	alreadyExistingCommits: Git.Oid[],
	n: number,
	repo: Git.Repository, //
	sig: Git.Signature
): Promise<Git.Reference> {
	assert(n > 0, "cannot append <= 0 commits");

	const commits: string[] = new Array(n)
		.fill(0) //
		.map((_, i) => "a".charCodeAt(0) + i + alreadyExistingCommits.length)
		.map((ascii) => String.fromCharCode(ascii));

	for (const c of commits) {
		const branchName: string = repo.isEmpty() ? "<initial>" : (await repo.getCurrentBranch()).shorthand();
		const cInBranch: string = c + " in " + branchName;

		const oid: Git.Oid = await fs.promises
			.writeFile(c, cInBranch) //
			.then(() => repo.createCommitOnHead([c], sig, sig, cInBranch));

		alreadyExistingCommits.push(oid);

		console.log(`oid of commit "%s" in branch "%s": %s`, c, branchName, oid);
	}

	return repo.getCurrentBranch();
}
