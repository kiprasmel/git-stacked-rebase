import fs from "fs";
import path from "path";
import assert from "assert";

import Git from "nodegit";

import { gitStackedRebase } from "../git-stacked-rebase";
import { configKeys } from "../configKeys";
import { humanOpAppendLineAfterNthCommit } from "../humanOp";

import { createExecSyncInRepo } from "../util/execSyncInRepo";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type

type Opts = {
	blockWithRead?: boolean;
	commitCount?: number;
} & SetupRepoOpts;
export async function setupRepoWithStackedBranches({
	blockWithRead = false, //
	commitCount = 12,
	...rest
}: Opts = {}) {
	const {
		repo, //
		config,
		sig,
		dir,
	} = await setupRepo(rest);

	const commitOidsInInitial: Git.Oid[] = [];
	const initialBranch: Git.Reference = await appendCommitsTo(commitOidsInInitial, 3, repo, sig);

	const latestStackedBranch: Git.Reference = await Git.Branch.create(
		repo,
		"stack-latest",
		await repo.getHeadCommit(),
		0
	);
	await repo.checkoutBranch(latestStackedBranch);

	const execSyncInRepo = createExecSyncInRepo(repo);

	const read = (): void => (blockWithRead ? void execSyncInRepo("read") : void 0);

	read();

	const commitOidsInLatestStacked: Git.Oid[] = [];
	await appendCommitsTo(commitOidsInLatestStacked, commitCount, repo, sig);

	const newPartialBranches = [
		["partial-1", 4],
		["partial-2", 6],
		["partial-3", 8],
	] as const;

	console.log("launching 0th rebase to create partial branches");
	await gitStackedRebase(initialBranch.shorthand(), {
		gitDir: dir,
		getGitConfig: () => config,
		editor: ({ filePath }) => {
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

		commitOidsInInitial,
		initialBranch,
		latestStackedBranch,
		execSyncInRepo,
		read,
		commitOidsInLatestStacked,
		newPartialBranches,
	} as const;
}

type SetupRepoOpts = {
	tmpdir?: boolean;
};
export async function setupRepo({
	tmpdir = true, //
}: SetupRepoOpts = {}) {
	const dir: string = createTmpdir(tmpdir);

	const foldersToDeletePath: string = path.join(__dirname, "folders-to-delete");
	fs.appendFileSync(foldersToDeletePath, dir + "\n", { encoding: "utf-8" });

	/**
	 * TODO make concurrent-safe (lol)
	 */
	process.chdir(dir);
	console.log("chdir to tmpdir %s", dir);

	const isBare = 0;
	const repo: Git.Repository = await Git.Repository.init(dir, isBare);

	const config: Git.Config = await repo.config();

	await config.setBool(configKeys.autoApplyIfNeeded, Git.Config.MAP.FALSE);
	await config.setString("user.email", "tester@test.com");
	await config.setString("user.name", "tester");

	/**
	 * gpg signing in tests not possible i believe,
	 * at least wasn't working.
	 */
	await config.setBool(configKeys.gpgSign, Git.Config.MAP.FALSE);

	/**
	 * fixups / not implemented in libgit2.
	 * though, would be better if received empty/minimal config by default..
	 */
	await config.setString("merge.conflictStyle", "diff3"); // zdiff3

	const sig: Git.Signature = await Git.Signature.default(repo);
	console.log("sig %s", sig);

	const inicialCommitId = "Initial commit (from setupRepo)";
	const initialCommit: Git.Oid = await fs.promises
		.writeFile(inicialCommitId, inicialCommitId) //
		.then(() => repo.createCommitOnHead([inicialCommitId], sig, sig, inicialCommitId));

	console.log("initial commit %s", initialCommit.tostrS());

	return {
		dir,
		repo,
		config,
		sig,
		initialCommit,
	} as const;
}

function createTmpdir(random: boolean = true): string {
	if (random) {
		return fs.mkdtempSync(path.join(__dirname, ".tmp-"), { encoding: "utf-8" });
	}

	const dir = path.join(__dirname, ".tmp");
	if (fs.existsSync(dir)) {
		fs.rmdirSync(dir, { recursive: true });
	}
	fs.mkdirSync(dir);
	return dir;
}

async function appendCommitsTo(
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
