/* eslint-disable @typescript-eslint/camelcase */

import { gitStackedRebase } from "../git-stacked-rebase";
import { SomeOptionsForGitStackedRebase } from "../options";
import {
	humanOpAppendLineAfterNthCommit, //
	humanOpRemoveLineOfCommit,
	humanOpChangeCommandOfNthCommitInto,
} from "../humanOp";
import { editor__internal, getGitConfig__internal } from "../internal";

import { setupRepoWithStackedBranches } from "../test/setupRepo";

export async function parseNewGoodCommandsSpec() {
	await succeeds_to_apply_after_break_or_exec();
	await succeeds_to_apply_after_implicit_drop();
	await succeeds_to_apply_after_explicit_drop();

	async function succeeds_to_apply_after_break_or_exec() {
		const { initialBranch, commitOidsInLatestStacked, dir, config } = await setupRepoWithStackedBranches();

		const branch = initialBranch.shorthand();
		const common: SomeOptionsForGitStackedRebase = {
			gitDir: dir,
			[getGitConfig__internal]: () => config,
		} as const;

		await gitStackedRebase(branch, {
			...common,
			[editor__internal]: ({ filePath }) => {
				const commitSHA: string = commitOidsInLatestStacked[7].tostrS();
				humanOpAppendLineAfterNthCommit("break", {
					filePath,
					commitSHA,
				});
			},
		});

		await gitStackedRebase(branch, {
			...common,
			apply: true,
		});
	}

	async function succeeds_to_apply_after_implicit_drop(): Promise<void> {
		const { initialBranch, commitOidsInLatestStacked, dir, config } = await setupRepoWithStackedBranches();
		const branch = initialBranch.shorthand();

		const common: SomeOptionsForGitStackedRebase = {
			gitDir: dir,
			[getGitConfig__internal]: () => config,
		} as const;

		await gitStackedRebase(branch, {
			...common,
			[editor__internal]: ({ filePath }) => {
				const commitSHA: string = commitOidsInLatestStacked[7].tostrS();
				humanOpRemoveLineOfCommit({ filePath, commitSHA });
			},
		});

		await gitStackedRebase(branch, {
			...common,
			apply: true,
		});
	}

	async function succeeds_to_apply_after_explicit_drop(): Promise<void> {
		const { initialBranch, commitOidsInLatestStacked, dir, config } = await setupRepoWithStackedBranches();
		const branch = initialBranch.shorthand();

		const common: SomeOptionsForGitStackedRebase = {
			gitDir: dir,
			[getGitConfig__internal]: () => config,
		};

		await gitStackedRebase(branch, {
			...common,
			[editor__internal]: ({ filePath }) => {
				const commitSHA: string = commitOidsInLatestStacked[7].tostrS();
				humanOpChangeCommandOfNthCommitInto("drop", {
					filePath,
					commitSHA,
				});
			},
		});

		await gitStackedRebase(branch, {
			...common,
			apply: true,
		});
	}
}
