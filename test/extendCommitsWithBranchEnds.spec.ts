/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";

import { noop } from "../util/noop";

import { appendCommitsTo, setupRepo } from "./setupRepo";

// import { gitStackedRebase } from "../git-stacked-rebase";
// import { humanOpAppendLineAfterNthCommit } from "../humanOp";

// import { setupRepoWithStackedBranches } from "./setupRepo";

export async function parseNewGoodCommandsSpec() {
	await succeeds_to_checkout_remote_branches_that_are_not_checked_out_locally_yet();

	/**
	 * what if already checked out locally but out of date?
	 * --reset-to-remote
	 */

	async function succeeds_to_checkout_remote_branches_that_are_not_checked_out_locally_yet() {
		const { repo, sig, execSyncInRepo } = await setupRepo();

		const commits: Git.Oid[] = [];
		const latestBranch: Git.Reference = await appendCommitsTo(commits, 10, repo, sig);

		noop(execSyncInRepo, latestBranch) // TODO

		/**
		 * create fake refs in `remotes/origin/`
		 */
	}

	// await succeeds_to_apply_after_break_or_exec();

	// async function succeeds_to_apply_after_break_or_exec() {
	// 	const { initialBranch, commitOidsInLatestStacked, dir, config } = await setupRepoWithStackedBranches();

	// 	const branch = initialBranch.shorthand();
	// 	const common = {
	// 		gitDir: dir,
	// 		getGitConfig: () => config,
	// 	} as const;

	// 	await gitStackedRebase(branch, {
	// 		...common,
	// 		editor: ({ filePath }) => {
	// 			humanOpAppendLineAfterNthCommit("break", {
	// 				filePath,
	// 				commitSHA: commitOidsInLatestStacked[7].tostrS(),
	// 			});
	// 		},
	// 	});

	// 	await gitStackedRebase(branch, {
	// 		...common,
	// 		apply: true,
	// 	});
	// }
}
