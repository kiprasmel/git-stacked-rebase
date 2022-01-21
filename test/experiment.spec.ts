#!/usr/bin/env ts-node-dev

import fs from "fs";
import path from "path";
import assert from "assert";

import Git from "nodegit";

import { gitStackedRebase, defaultGitCmd } from "../git-stacked-rebase";

import { RegularRebaseCommand } from "../parse-todo-of-stacked-rebase/validator";
import { createExecSyncInRepo } from "../util/execSyncInRepo";
import { configKeys } from "../configKeys";

export async function testCase() {
	const {
		repo, //
		sig,
		dir,
	} = await setupRepo();

	const config: Git.Config = await repo.config();
	config.setBool(configKeys.autoApplyIfNeeded, Git.Config.MAP.FALSE);

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

	execSyncInRepo("read");

	const commitOidsInLatestStacked: Git.Oid[] = [];
	await appendCommitsTo(commitOidsInLatestStacked, 12, repo, sig);

	const newPartialBranches = [
		["partial-1", 4],
		["partial-2", 6],
		["partial-3", 8],
	] as const;

	console.log("launching 1st rebase to create partial branches");
	await gitStackedRebase(initialBranch.shorthand(), {
		gitDir: dir,
		getGitConfig: () => config,
		editor: async ({ filePath }) => {
			console.log("filePath %s", filePath);

			for (const [newPartial, nthCommit] of newPartialBranches) {
				await humanOpAppendLineAfterNthCommit(
					filePath,
					commitOidsInLatestStacked[nthCommit].tostrS(),
					`branch-end-new ${newPartial}`
				);
			}

			console.log("finished editor");

			execSyncInRepo("read");
		},
	});

	console.log("looking up branches to make sure they were created successfully");
	execSyncInRepo("read");
	for (const [newPartial] of newPartialBranches) {
		/**
		 * will throw if branch does not exist
		 * TODO "properly" expect to not throw
		 */
		await Git.Branch.lookup(repo, newPartial, Git.Branch.BRANCH.LOCAL);
	}

	/**
	 *
	 */
	console.log("launching 2nd rebase to change command of nth commit");
	execSyncInRepo("read");

	const nthCommit2ndRebase = 5;

	await gitStackedRebase(initialBranch.shorthand(), {
		gitDir: dir,
		getGitConfig: () => config,
		editor: async ({ filePath }) => {
			const SHA = commitOidsInLatestStacked[nthCommit2ndRebase].tostrS();

			humanOpChangeCommandOfNthCommitInto("edit", SHA, filePath);
		},
	});
	/**
	 * rebase will now exit because of the "edit" command,
	 * and so will our stacked rebase,
	 * allowing us to edit.
	 */

	fs.writeFileSync(nthCommit2ndRebase.toString(), "new data from 2nd rebase\n");

	execSyncInRepo(`${defaultGitCmd} add .`);
	execSyncInRepo(`${defaultGitCmd} -c commit.gpgSign=false commit --amend --no-edit`);

	execSyncInRepo(`${defaultGitCmd} rebase --continue`);

	/**
	 * now some partial branches will be "gone" from the POV of the latestBranch<->initialBranch.
	 *
	 * TODO verify they are gone (history got modified successfully)
	 */

	// TODO

	/**
	 * TODO continue with --apply
	 * TODO and then verify that partial branches are "back" in our POV properly.
	 */

	console.log("attempting early 3rd rebase to --apply");
	execSyncInRepo("read");

	await gitStackedRebase(initialBranch.shorthand(), {
		gitDir: dir,
		getGitConfig: () => config,
		apply: true,
	});
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRepo() {
	const dir: string = path.join(__dirname, ".tmp");
	fs.rmdirSync(dir, { recursive: true });
	fs.mkdirSync(dir);
	console.log("tmpdir path %s", dir);

	const foldersToDeletePath: string = path.join(__dirname, "folders-to-delete");
	fs.appendFileSync(foldersToDeletePath, dir + "\n", { encoding: "utf-8" });

	process.chdir(dir);
	console.log("chdir to tmpdir");

	const isBare = 0;
	const repo: Git.Repository = await Git.Repository.init(dir, isBare);

	const sig: Git.Signature = await Git.Signature.default(repo);
	console.log("sig %s", sig);

	const inicialCommitId = "Initial commit (from setupRepo)";
	const initialCommit: Git.Oid = await fs.promises
		.writeFile(inicialCommitId, inicialCommitId) //
		.then(() => repo.createCommitOnHead([inicialCommitId], sig, sig, inicialCommitId));

	return {
		dir,
		repo,
		sig,
		initialCommit,
	} as const;
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

/**
 * TODO general "HumanOp" for `appendLineAfterNthCommit` & similar utils
 */
async function humanOpAppendLineAfterNthCommit(
	filePath: string, //
	commitSHA: string,
	newLine: string
): Promise<void> {
	const file = await fs.promises.readFile(filePath, { encoding: "utf-8" });
	const lines = file.split("\n");
	const lineIdx: number = lines.findIndex((line) => line.startsWith(`pick ${commitSHA}`));

	console.log("commitSHA: %s, lineIdx: %s, newLine: %s", commitSHA, lineIdx, newLine);

	lines.splice(lineIdx, 0, newLine);

	await fs.promises.writeFile(filePath, lines.join("\n"));
}

function humanOpChangeCommandOfNthCommitInto(
	newCommand: RegularRebaseCommand, //
	commitSHA: string,
	filePath: string
): void {
	const file = fs.readFileSync(filePath, { encoding: "utf-8" });
	const lines = file.split("\n");
	const lineIdx: number = lines.findIndex((line) => line.startsWith(`pick ${commitSHA}`));

	console.log("commitSHA: %s, lineIdx: %s, newCommand: %s", commitSHA, lineIdx, newCommand);

	const parts = lines[lineIdx].split(" ");
	parts[0] = newCommand;
	lines[lineIdx] = parts.join(" ");

	fs.writeFileSync(filePath, lines.join("\n"));
}
