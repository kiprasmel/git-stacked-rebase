#!/usr/bin/env ts-node-dev

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from "assert";

import { gitStackedRebase } from "../git-stacked-rebase";
import { editor__internal } from "../internal";
import { nativeGetBranchNames } from "../native-git/branch";

import { setupRemoteRepo } from "./util/setupRemoteRepo";

export default async function run() {
	await auto_checks_out_remote_partial_branches();
}

async function auto_checks_out_remote_partial_branches() {
	const { RemoteAlice, LocalBob } = await setupRemoteRepo();

	/**
	 * switch to latest branch to perform stacked rebase
	 */
	LocalBob.execSyncInRepo(`git checkout ${RemoteAlice.repoMeta.latestStackedBranchName}`);

	const remotePartialBranchesInAlice: string[] = RemoteAlice.repoMeta.partialBranches.map((b) => b.shorthand());
	const localPartialBranchesInBobBefore: string[] = findPartialBranchesThatArePresentLocally();

	function findPartialBranchesThatArePresentLocally(
		localBranches: string[] = nativeGetBranchNames(LocalBob.repo.workdir())("local")
	) {
		return remotePartialBranchesInAlice.filter((partial) => localBranches.includes(partial));
	}

	assert.deepStrictEqual(
		localPartialBranchesInBobBefore.length,
		0,
		"expected partial branches to __not be__ checked out locally, to be able to test later that they will be."
	);

	await gitStackedRebase(RemoteAlice.repoMeta.initialBranch, {
		[editor__internal]: () => void 0 /** no edit */,
		gitDir: LocalBob.repo.workdir(),
	});

	const localPartialBranchesInBobAfter: string[] = findPartialBranchesThatArePresentLocally();

	console.log({
		remotePartialBranchesInAlice,
		localPartialBranchesInBobBefore,
		localPartialBranchesInBobAfter,
	});

	assert.deepStrictEqual(
		localPartialBranchesInBobAfter.length,
		remotePartialBranchesInAlice.length,
		"expected partial branches to __be__ checked out locally by git-stacked-rebase."
	);
}

if (!module.parent) {
	run();
}
