import Git from "nodegit";

import {
	CommitAndBranchBoundary,
	getWantedCommitsWithBranchBoundariesOurCustomImpl,
	removeLocalAndRemoteRefPrefix,
} from "./git-stacked-rebase";
import { parseGithubRemoteUrl, createGithubURLForStackedPR } from "./adapter-github";
import { pickRemoteFromRepo } from "./forcePush";

import { AskQuestion, askWhichBranchEndToUseForStackedPRs } from "./util/createQuestion";
import { Triple } from "./util/tuple";
import { Termination } from "./util/error";

export type GenerateListOfURLsToCreateStackedPRsCtx = {
	repo: Git.Repository;
	initialBranch: Git.Reference;
	currentBranch: Git.Reference;
	ignoredBranches: string[];
	askQuestion: AskQuestion;
};

export async function generateListOfURLsToCreateStackedPRs({
	repo,
	initialBranch,
	currentBranch,
	ignoredBranches,
	askQuestion,
}: GenerateListOfURLsToCreateStackedPRsCtx): Promise<string[]> {
	const branchBoundaries: CommitAndBranchBoundary[] = await getWantedCommitsWithBranchBoundariesOurCustomImpl(
		repo,
		initialBranch,
		currentBranch
	);

	const stackedBranchesReadyForStackedPRs: CommitBranch[] = await getStackedBranchesReadyForStackedPRs({
		branchBoundaries,
		ignoredBranches,
		askQuestion,
	});

	// console.log({
	// 	stackedBranchesReadyForStackedPRs: stackedBranchesReadyForStackedPRs.map((x) => x.slice(0, 2).join("  ")),
	// });

	const remoteName: string = await pickRemoteFromRepo(repo, {
		cannotDoXWhenZero: "Cannot create pull requests without any remotes.",
		pleaseChooseOneFor: "creating pull requests",
	});

	const remote: Git.Remote = await Git.Remote.lookup(repo, remoteName);

	const parsedGithubUrlData = parseGithubRemoteUrl(remote.url());

	/**
	 * TODO:
	 *
	 * - [ ] check if some PRs already exist?
	 * - [ ] check if github
	 * - [ ] check if all branches in the same remote; otherwise ask which one to use
	 * - [ ]
	 */
	const githubURLsForCreatingPRs: string[] = [];
	let prevBranch: string = stackedBranchesReadyForStackedPRs[0][1];

	for (const [_commit, branch] of stackedBranchesReadyForStackedPRs.slice(1)) {
		const url: string = createGithubURLForStackedPR({
			repoOwner: parsedGithubUrlData.repoOwner,
			repo: parsedGithubUrlData.repo,
			baseBranch: prevBranch,
			newBranch: branch,
		});

		githubURLsForCreatingPRs.push(url);

		prevBranch = branch;
	}

	// console.log({ githubURLsForCreatingPRs });

	return githubURLsForCreatingPRs;
}

/**
 * ---
 */

export type CommitBranch = Triple<string, string, Git.Reference>;

export type GetStackedBranchesReadyForStackedPRsCtx = {
	branchBoundaries: CommitAndBranchBoundary[];
	askQuestion: AskQuestion;
	ignoredBranches: string[];
};

export async function getStackedBranchesReadyForStackedPRs({
	branchBoundaries,
	ignoredBranches,
	askQuestion,
}: GetStackedBranchesReadyForStackedPRsCtx): Promise<CommitBranch[]> {
	const result: CommitBranch[] = [];

	for (let boundary of branchBoundaries) {
		if (!boundary.branchEnd?.length) {
			continue;
		}

		const commitSha: string = boundary.commit.sha();
		const branchEnds: string[] = boundary.branchEnd
			.map((b) => removeLocalAndRemoteRefPrefix(b.name())) //
			.filter((b) => !ignoredBranches.some((ignoredBranchSubstr) => b.includes(ignoredBranchSubstr)));

		if (branchEnds.length === 1) {
			result.push([commitSha, branchEnds[0], boundary.branchEnd[0]]);
		} else {
			/**
			 * >1 branch end,
			 * thus need the user to pick one.
			 *
			 * we need to know which branch to use (only 1),
			 * because need to know on top of which to stack later PRs.
			 */

			const chosenBranch: string = await askWhichBranchEndToUseForStackedPRs({ branchEnds, commitSha, askQuestion });
			const chosenBranchRef: Git.Reference = boundary.branchEnd.find(
				(be) => removeLocalAndRemoteRefPrefix(be.name()) === chosenBranch
			)!;

			if (!chosenBranchRef) {
				const msg = `chosen branch was picked, but it's Git.Reference was not found. likely a bug.`;
				throw new Termination(msg);
			}

			result.push([commitSha, chosenBranch, chosenBranchRef]);
		}
	}

	return result;
}
