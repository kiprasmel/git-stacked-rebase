/* eslint-disable @typescript-eslint/camelcase */

import { gitStackedRebase } from "../git-stacked-rebase";
import { humanOpAppendLineAfterNthCommit } from "../humanOp";

import { setupRepoWithStackedBranches } from "../test/setupRepo";

export async function parseNewGoodCommandsSpec() {
	await succeeds_to_apply_after_break_or_exec();

	async function succeeds_to_apply_after_break_or_exec() {
		const { initialBranch, commitOidsInLatestStacked, dir, config } = await setupRepoWithStackedBranches();

		const branch = initialBranch.shorthand();
		const common = {
			gitDir: dir,
			getGitConfig: () => config,
		} as const;

		await gitStackedRebase(branch, {
			...common,
			editor: ({ filePath }) => {
				humanOpAppendLineAfterNthCommit("break", {
					filePath,
					commitSHA: commitOidsInLatestStacked[7].tostrS(),
				});
			},
		});

		await gitStackedRebase(branch, {
			...common,
			apply: true,
		});
	}
}
