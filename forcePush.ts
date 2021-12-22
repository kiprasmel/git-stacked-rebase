/* eslint-disable indent */

// import fs from "fs";

import {
	branchSequencer, //
	BranchSequencerBase,
	// getBackupPathOfPreviousStackedRebase,
} from "./branchSequencer";

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
		actionInsideEachCheckedOutBranch: ({ execSyncInRepo }) => {
			execSyncInRepo(`${argsBase.gitCmd} push --force`);
		},
		delayMsBetweenCheckouts: 0,
		rewrittenListFile: "rewritten-list.applied",
	});
