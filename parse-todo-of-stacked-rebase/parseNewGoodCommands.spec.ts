/* eslint-disable @typescript-eslint/camelcase */

import { gitStackedRebase } from "../git-stacked-rebase";
import {
	humanOpAppendLineAfterNthCommit, //
	humanOpRemoveLineOfCommit,
	humanOpChangeCommandOfNthCommitInto,
} from "../humanOp";
import { editor__internal } from "../internal";

import { setupRepo } from "../test/setupRepo";

export async function parseNewGoodCommandsSpec(): Promise<void> {
	await succeeds_to_apply_after_break_or_exec();
	await succeeds_to_apply_after_implicit_drop();
	await succeeds_to_apply_after_explicit_drop();

	async function succeeds_to_apply_after_break_or_exec(): Promise<void> {
		const { initialBranch, common, commitsInLatest } = await setupRepo();

		await gitStackedRebase(initialBranch, {
			...common,
			[editor__internal]: ({ filePath }) => {
				humanOpAppendLineAfterNthCommit("break", {
					filePath, //
					commitSHA: commitsInLatest[7],
				});
			},
		});

		await gitStackedRebase(initialBranch, {
			...common,
			apply: true,
		});
	}

	async function succeeds_to_apply_after_implicit_drop(): Promise<void> {
		const { initialBranch, common, commitsInLatest } = await setupRepo();

		await gitStackedRebase(initialBranch, {
			...common,
			[editor__internal]: ({ filePath }) => {
				humanOpRemoveLineOfCommit({
					filePath, //
					commitSHA: commitsInLatest[7],
				});
			},
		});

		await gitStackedRebase(initialBranch, {
			...common,
			apply: true,
		});
	}

	async function succeeds_to_apply_after_explicit_drop(): Promise<void> {
		const { initialBranch, common, commitsInLatest } = await setupRepo();

		await gitStackedRebase(initialBranch, {
			...common,
			[editor__internal]: ({ filePath }) => {
				humanOpChangeCommandOfNthCommitInto("drop", {
					filePath, //
					commitSHA: commitsInLatest[7],
				});
			},
		});

		await gitStackedRebase(initialBranch, {
			...common,
			apply: true,
		});
	}
}
