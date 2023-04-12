import assert from "assert";
import path from "path";

import Git from "nodegit";

import { configKeys } from "../config";
import { gitStackedRebase } from "../git-stacked-rebase";
import { humanOpChangeCommandOfNthCommitInto } from "../humanOp";
import { askQuestion__internal, editor__internal, noEditor } from "../internal";

import { setupRepo } from "./util/setupRepo";
import { question, Questions } from "../util/createQuestion";
import { isMarkedThatNeedsToApply } from "../apply";

export async function applyTC() {
	await integration__git_stacked_rebase_exits_if_apply_was_needed_but_user_disallowed();
}

/**
 * create a scenario where an apply is needed, and disallow it - GSR should exit.
 */
async function integration__git_stacked_rebase_exits_if_apply_was_needed_but_user_disallowed() {
	const { common, commitsInLatest, config, repo } = await setupRepo();

	/**
	 * ensure autoApplyIfNeeded is disabled
	 */
	config.setBool(configKeys.autoApplyIfNeeded, Git.Config.MAP.FALSE);

	/**
	 * force modify history, so that an apply will be needed
	 */
	await gitStackedRebase({
		...common,
		[editor__internal]: ({ filePath }) => {
			humanOpChangeCommandOfNthCommitInto("drop", {
				filePath, //
				commitSHA: commitsInLatest[2],
			});
		},
	});

	// TODO take from `gitStackedRebase`:
	const dotGitDirPath: string = repo.path();
	const pathToStackedRebaseDirInsideDotGit: string = path.join(dotGitDirPath, "stacked-rebase");
	assert.deepStrictEqual(
		isMarkedThatNeedsToApply(pathToStackedRebaseDirInsideDotGit), //
		true,
		`expected a "needs-to-apply" mark to be set.`
	);

	console.log("performing 2nd rebase, expecting it to throw.");

	const threw: boolean = await didThrow(() =>
		/**
		 * perform the rebase again - now that an apply is marked as needed,
		 * and autoApplyIfNeeded is disabled,
		 * we should get prompted to allow the apply.
		 */
		gitStackedRebase({
			...common,
			...noEditor,
			[askQuestion__internal]: (q, ...rest) => {
				if (q === Questions.need_to_apply_before_continuing) {
					return "n";
				}

				return question(q, ...rest);
			},
		})
	);

	assert.deepStrictEqual(
		threw,
		true,
		`expected 2nd invocation of rebase to throw, because user did not allow to perform a mandatory --apply.\nbut threw = ${threw} (expected true).`
	);
}

export async function didThrow(fn: Function): Promise<boolean> {
	try {
		await fn();
		return false;
	} catch (_e) {
		return true;
	}
}
