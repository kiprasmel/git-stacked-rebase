/* eslint-disable indent */

// import fs from "fs";

import Git from "nodegit";

import {
	BehaviorOfGetBranchBoundaries,
	branchSequencer, //
	BranchSequencerBase,
	// getBackupPathOfPreviousStackedRebase,
} from "./branchSequencer";

import { createQuestion } from "./util/createQuestion";

export const forcePush: BranchSequencerBase = (argsBase) =>
	// /**
	//  * TODO TESTS we __really__ need to make sure we test this one lmao
	//  */
	// let pathToStackedRebaseDirInsideDotGit: string;

	// if (fs.existsSync(argsBase.pathToStackedRebaseDirInsideDotGit)) {
	// 	pathToStackedRebaseDirInsideDotGit = argsBase.pathToStackedRebaseDirInsideDotGit;
	// } else {
	// 	const previous = getBackupPathOfPreviousStackedRebase(argsBase.pathToStackedRebaseDirInsideDotGit);

	// 	// if (!fs.existsSync(previous)) {
	// 	// }

	// 	/**
	// 	 * attempt to continue w/ the latest rebase that happened.
	// 	 *
	// 	 * if folder not found, branchSequencer should handle it
	// 	 * the same way as it would've handled the folder from argsBase.
	// 	 */
	// 	pathToStackedRebaseDirInsideDotGit = previous;
	// }

	branchSequencer({
		...argsBase,
		// pathToStackedRebaseDirInsideDotGit,
		actionInsideEachCheckedOutBranch: async ({ execSyncInRepo, repo }) => {
			const branch: Git.Reference = await repo.getCurrentBranch();
			const upstreamBranch: Git.Reference | null = await Git.Branch.upstream(branch).catch(() => null);

			/**
			 * TODO work out a good solution because we don't want the user
			 * to get interrupted while in-between the "push" flow,
			 * or at least handle it ourselves / ask the user how to continue
			 *
			 * maybe need to have a `--push --continue`?
			 * ugh, starts to get mixed up w/ other commands, idk!
			 * or could `--continue` be used in any circumstance,
			 * i.e. both in a rebase setting, and in a push setting?
			 *
			 * could maybe utilize --dry-run? or analyze ourselves? idk
			 *
			 * needs to be further explored with our `--sync` (TBD)
			 *
			 *
			 * on --force-if-includes, see:
			 * - `man git-push`
			 * - https://stackoverflow.com/a/65839129/9285308
			 * - https://github.com/gitextensions/gitextensions/issues/8753#issuecomment-763390579
			 */
			const forceWithLeaseOrForce: string = "--force-with-lease --force-if-includes";

			if (!upstreamBranch) {
				const remotes: string[] = await repo.getRemoteNames();

				if (remotes.length === 0) {
					throw new Error("0 remotes found, cannot push a new branch into a remote.");
				}

				let remote: string;

				if (remotes.length === 1) {
					remote = remotes[0];
				} else {
					const indices: string[] = remotes.map((_, i) => i + 1).map((x) => x.toString());

					const question = createQuestion();

					let answer: string = "";

					let first = true;
					while (!remotes.includes(answer)) {
						answer = (
							await question(
								(first ? "\n" : "") +
									"multiple remotes detected, please choose one for new branch:" +
									remotes.map((r, i) => `\n  ${i + 1} ${r}`).join("") +
									"\n> "
							)
						)
							.trim()
							.toLowerCase();

						if (indices.includes(answer)) {
							answer = remotes[Number(answer) - 1];
						}

						first = false;
					}

					remote = answer;
				}

				const cmd = `push -u ${remote} ${branch.name()} ${forceWithLeaseOrForce}`;
				console.log(`running ${cmd}`);
				execSyncInRepo(`${argsBase.gitCmd} ${cmd}`);
			} else {
				execSyncInRepo(`${argsBase.gitCmd} push ${forceWithLeaseOrForce}`);
			}
		},
		delayMsBetweenCheckouts: 0,

		/**
		 * `--push` should not be allowed if `--apply` has not ran yet,
		 * thus this is the desired behavior.
		 */
		behaviorOfGetBranchBoundaries:
			BehaviorOfGetBranchBoundaries["ignore-unapplied-state-and-use-simple-branch-traversal"],

		/**
		 * (experimental)
		 *
		 * github just closed (emptily merged) one of the PRs
		 * because some commit was now already part of some other branch.
		 *
		 * pretty sure that pushing newest branches first, and oldest later,
		 * instead of the current "oldest first, then newest",
		 * would solve this.
		 */
		reverseCheckoutOrder: true,
	});
