/* eslint-disable @typescript-eslint/camelcase */

import fs from "fs";
import path from "path";
import assert from "assert";

import Git from "nodegit";

import { gitStackedRebase } from "../../git-stacked-rebase";
import { defaultGitCmd, SomeOptionsForGitStackedRebase } from "../../options";
import { configKeys } from "../../config";
import { humanOpAppendLineAfterNthCommit } from "../../humanOp";
import { editor__internal, getGitConfig__internal } from "../../internal";
import { getBranches, nativeGetBranchNames, nativePush } from "../../native-git/branch";

import { createExecSyncInRepo } from "../../util/execSyncInRepo";
import { UnpromiseFn } from "../../util/Unpromise";

import { createTmpdir, CreateTmpdirOpts } from "./tmpdir";

type Opts = {
	blockWithRead?: boolean;
	commitCount?: number;

	/**
	 *
	 */
	initRepoBase?: typeof setupRepoBase | UnpromiseFn<typeof setupRepoBase>;
} & Omit<SetupRepoOpts, "bare">;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRepo({
	blockWithRead = false, //
	commitCount = 12,
	initRepoBase,
	...rest
}: Opts = {}) {
	const ctx: SetupRepoOpts = { ...rest, bare: 0 };

	const base = await (initRepoBase?.(ctx) ?? setupRepoBase(ctx));

	const initialCommitId = "Initial-commit-from-setupRepo";
	const initialCommitFilePath = path.join(base.dir, initialCommitId);
	const relFilepaths = [initialCommitId];

	fs.writeFileSync(initialCommitFilePath, initialCommitId);
	const initialCommit: Git.Oid = await base.repo.createCommitOnHead(
		relFilepaths, //
		base.sig,
		base.sig,
		initialCommitId
	);

	console.log("initial commit %s", initialCommit.tostrS());

	const commitOidsInInitial: Git.Oid[] = [];
	const initialBranchRef: Git.Reference = await appendCommitsTo(
		commitOidsInInitial, //
		3,
		base.repo,
		base.sig,
		base.dir
	);

	const initialBranch: string = initialBranchRef.shorthand();
	const commitsInInitial: string[] = commitOidsInInitial.map((oid) => oid.tostrS());

	const latestStackedBranchName = "stack-latest";
	const headCommit: Git.Commit = await base.repo.getHeadCommit();
	const createBranchCmd = `${defaultGitCmd} checkout -b ${latestStackedBranchName} ${headCommit}`;
	base.execSyncInRepo(createBranchCmd);

	const read = (): void => (blockWithRead ? void base.execSyncInRepo("read") : void 0);

	read();

	const commitOidsInLatestStacked: Git.Oid[] = [];
	await appendCommitsTo(commitOidsInLatestStacked, commitCount, base.repo, base.sig, base.dir);

	const commitsInLatest: string[] = commitOidsInLatestStacked.map((oid) => oid.tostrS());

	const newPartialBranches = [
		["partial-1", 4],
		["partial-2", 6],
		["partial-3", 8],
	] as const;

	console.log("launching 0th rebase to create partial branches");
	await gitStackedRebase(initialBranch, {
		...base.common,
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
	const partialBranches: Git.Reference[] = [];
	for (const [newPartial] of newPartialBranches) {
		/**
		 * will throw if branch does not exist
		 * TODO "properly" expect to not throw
		 */
		const branch = await Git.Branch.lookup(base.repo, newPartial, Git.Branch.BRANCH.LOCAL);
		partialBranches.push(branch);
	}

	return {
		...base,
		read, // TODO move to base

		initialBranchRef,
		initialBranch,
		commitOidsInInitial,
		commitsInInitial,

		latestStackedBranchName,
		commitOidsInLatestStacked,
		commitsInLatest,

		partialBranches,
		newPartialBranches,
	} as const;
}

export type InitRepoCtx = {
	Git: typeof Git;
	dir: string;
	bare: number;
};

export type SetupRepoOpts = Partial<CreateTmpdirOpts> & {
	initRepo?: (ctx: InitRepoCtx) => Promise<Git.Repository>;
};

export type RepoBase = ReturnType<typeof setupRepoBase>;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRepoBase({
	random = true, //
	bare = 0,
	infoPrefix = "",
	initRepo = (ctx) => ctx.Git.Repository.init(ctx.dir, ctx.bare),
}: SetupRepoOpts = {}) {
	const dir: string = createTmpdir({ random, bare, infoPrefix });

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

	const getBranchNames = nativeGetBranchNames(repo.workdir());

	return {
		dir,
		repo,
		config,
		sig,
		execSyncInRepo,
		common,
		//
		getBranchNames,
		getBranches: getBranches(repo),
		push: nativePush(repo.workdir()),
	} as const;
}

export async function appendCommitsTo(
	alreadyExistingCommits: Git.Oid[],
	n: number,
	repo: Git.Repository, //
	sig: Git.Signature,
	dir: string
): Promise<Git.Reference> {
	assert(n > 0, "cannot append <= 0 commits");

	const commits: string[] = new Array(n)
		.fill(0) //
		.map((_, i) => "a".charCodeAt(0) + i + alreadyExistingCommits.length)
		.map((ascii) => String.fromCharCode(ascii));

	for (const commit of commits) {
		const branchName: string = repo.isEmpty() ? "<initial>" : (await repo.getCurrentBranch()).shorthand();
		const commitTitle: string = commit + " in " + branchName;

		const commitFilePath: string = path.join(dir, commit);
		const relFilepaths = [commit];

		fs.writeFileSync(commitFilePath, commitTitle);
		const oid: Git.Oid = await repo.createCommitOnHead(relFilepaths, sig, sig, commitTitle);

		alreadyExistingCommits.push(oid);

		console.log(`oid of commit "%s" in branch "%s": %s`, commit, branchName, oid);
	}

	return await repo.getCurrentBranch();
}
