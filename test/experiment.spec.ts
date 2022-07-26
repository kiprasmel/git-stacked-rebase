#!/usr/bin/env ts-node-dev

/* eslint-disable @typescript-eslint/camelcase */

import fs from "fs";

import { setupRepoWithStackedBranches } from "./setupRepo";

import { defaultGitCmd } from "../options";
import { gitStackedRebase } from "../git-stacked-rebase";
import { humanOpChangeCommandOfNthCommitInto } from "../humanOp";
import { editor__internal, getGitConfig__internal } from "../internal";

export async function testCase() {
	const {
		initialBranch, //
		dir,
		config,
		commitOidsInLatestStacked,
		read,
		execSyncInRepo,
	} = await setupRepoWithStackedBranches();

	/**
	 *
	 */
	console.log("launching 2nd rebase to change command of nth commit");
	read();

	const nthCommit2ndRebase = 5;

	await gitStackedRebase(initialBranch.shorthand(), {
		gitDir: dir,
		[getGitConfig__internal]: () => config,
		[editor__internal]: async ({ filePath }) => {
			const SHA = commitOidsInLatestStacked[nthCommit2ndRebase].tostrS();

			humanOpChangeCommandOfNthCommitInto("edit", { filePath, commitSHA: SHA });
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

	execSyncInRepo(`${defaultGitCmd} status`);
	read();

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
	read();

	await gitStackedRebase(initialBranch.shorthand(), {
		gitDir: dir,
		[getGitConfig__internal]: () => config,
		apply: true,
	});
}
