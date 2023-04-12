#!/usr/bin/env ts-node-dev

import fs from "fs";
import path from "path";
import assert from "assert";

import { gitStackedRebase } from "../git-stacked-rebase";

import { setupRepo } from "./util/setupRepo";
import { isMarkedThatNeedsToApply } from "../apply";
import { filenames } from "../filenames";
import { askQuestion__internal, editor__internal, noEditor } from "../internal";
import { humanOpChangeCommandOfNthCommitInto } from "../humanOp";
import { Questions, question } from "../util/createQuestion";

export async function nonFirstRebaseHasInitialBranchCached_TC() {
	await scenario1();
}

async function scenario1() {
	const { common, repo, commitsInLatest } = await setupRepo();

	const initialBranch = "master" as const;

	await gitStackedRebase({
		...common,
		initialBranch,
		apply: false,
		autoApplyIfNeeded: false,
		[editor__internal]: ({ filePath }) => {
			/**
			 * force an apply to be needed, so that a second rebase is meaningful
			 */
			humanOpChangeCommandOfNthCommitInto("drop", {
				filePath, //
				commitSHA: commitsInLatest[2],
			});
		},
	});

	// BEGIN COPY_PASTE
	// TODO take from `gitStackedRebase`:
	const dotGitDirPath: string = repo.path();
	const pathToStackedRebaseDirInsideDotGit: string = path.join(dotGitDirPath, "stacked-rebase");
	assert.deepStrictEqual(
		isMarkedThatNeedsToApply(pathToStackedRebaseDirInsideDotGit), //
		true,
		`expected a "needs-to-apply" mark to be set.`
	);
	// END COPY_PASTE

	const pathToCache: string = path.join(pathToStackedRebaseDirInsideDotGit, filenames.initialBranch);
	const isCached: boolean = fs.existsSync(pathToCache);
	assert.deepStrictEqual(isCached, true, `expected initial branch to be cached after 1st run.`);

	const cachedValue: string = fs.readFileSync(pathToCache, { encoding: "utf-8" });
	assert.deepStrictEqual(
		cachedValue,
		initialBranch,
		`expected the correct value to be cached ("${initialBranch}"), but found "${cachedValue}".`
	);

	console.log("performing 2nd rebase, expecting it to re-use the cached value of the initialBranch successfully.");

	await gitStackedRebase({
		...common,
		/**
		 * force unset initial branch
		 */
		initialBranch: undefined,
		...noEditor,
		[askQuestion__internal]: (q, ...rest) => {
			if (q === Questions.need_to_apply_before_continuing) return "y";
			return question(q, ...rest);
		},
	});
}

if (!module.parent) {
	nonFirstRebaseHasInitialBranchCached_TC();
}
