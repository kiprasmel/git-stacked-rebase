#!/usr/bin/env ts-node-dev

/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from "assert";

import { BranchWhoNeedsLocalCheckout, decodeLineToCmd, encodeCmdToLine, gitStackedRebase } from "../git-stacked-rebase";
import { editor__internal } from "../internal";
import { nativeGetBranchNames } from "../native-git/branch";
import { modifyLines } from "../humanOp";

import { setupRemoteRepo } from "./util/setupRemoteRepo";

export default async function run() {
	await auto_checks_out_remote_partial_branches();
	await give_chosen_name_to_local_branch();
}

async function auto_checks_out_remote_partial_branches() {
	const { RemoteAlice, LocalBob } = await setupRemoteRepo();

	/**
	 * switch to latest branch to perform stacked rebase
	 */
	LocalBob.execSyncInRepo(`git checkout ${RemoteAlice.latestStackedBranchName}`);

	const remotePartialBranchesInAlice: string[] = RemoteAlice.partialBranches.map((b) => b.shorthand());
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

	await gitStackedRebase(RemoteAlice.initialBranch, {
		gitDir: LocalBob.repo.workdir(),
		[editor__internal]: () => void 0 /** no edit */,
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

async function give_chosen_name_to_local_branch() {
	const { RemoteAlice, LocalBob } = await setupRemoteRepo();

	/**
	 * switch to latest branch to perform stacked rebase
	 */
	LocalBob.execSyncInRepo(`git checkout ${RemoteAlice.latestStackedBranchName}`);

	const renamedLocalBranch = "partial-renamed-local-branch-hehe" as const;

	const isPartial = (b: string): boolean => b.includes("partial")

	assert(isPartial(renamedLocalBranch))

	// TODO TS
	// @ts-ignore
	const remotePartialBranchesInAlice: string[] = findPartialBranches(RemoteAlice);
	const localPartialBranchesInBobBefore: string[] = findPartialBranches(LocalBob)

	// TODO CLEANUP PREV TEST TOO
	function findPartialBranches(owner: typeof RemoteAlice | typeof LocalBob, workdir = owner.repo.workdir()): string[] {
		return nativeGetBranchNames(workdir)("local").filter(isPartial)
	}

	assert.deepStrictEqual(
		localPartialBranchesInBobBefore.length,
		0,
		"expected partial branches to __not be__ checked out locally, to be able to test later that they will be."
	);

	await gitStackedRebase(RemoteAlice.initialBranch, {
		gitDir: LocalBob.repo.workdir(),
		[editor__internal]: ({filePath}) => {
			const branchNameOf2ndBranch: string = RemoteAlice.newPartialBranches[1][0];
			modifyLines(filePath, (lines) => {
				const lineIdx: number = lines.findIndex(l => l.includes(branchNameOf2ndBranch))!
				const line: string = lines[lineIdx];
				const cmd: BranchWhoNeedsLocalCheckout = decodeLineToCmd(line)
				console.log({
					lineIdx,
					line,
					cmd
				})
				const newCmd: BranchWhoNeedsLocalCheckout = {
					...cmd,
					wantedLocalBranchName: renamedLocalBranch,
				}
				const newLine: string = encodeCmdToLine(newCmd)
				const newLines: string[] = lines.map((oldLine, i) => i === lineIdx ? newLine : oldLine)
				return newLines;
			})
		},
	});

	const localPartialBranchesInBobAfter: string[] = findPartialBranches(LocalBob)

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
};

if (!module.parent) {
	run();
}
