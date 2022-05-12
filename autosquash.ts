/* eslint-disable indent */

import Git from "nodegit";

import { CommitAndBranchBoundary } from "./git-stacked-rebase";

import { Termination } from "./util/error";
import { assertNever } from "./util/assertNever";

/**
 * the general approach on how to handle autosquashing
 * is the following, in order:
 *
 * 1. collect your commits,
 * 2. extend them with branch boundaries,
 * 3. re-order the "fixup!" and "squash!" commits,
 * 4. convert from objects to strings that are joined
 *    with a newline and written to the git-rebase-todo file
 *
 *
 * if we were to do (3) before (2)
 * (which is what happens if we would use git's native rebase
 * to collect the commits),
 * then, in a situation where a commit with a "fixup!" or "squash!" subject
 * is the latest commit of any branch in the stack,
 * that commit will move not only itself, but it's branch as well.
 *
 * we don't want that obviously - we instead want the branch
 * to point to a commit that was before the "fixup!" or "squash!" commit
 * (and same applies if there were multiple "fixup!" / "squash!" commits in a row).
 *
 * see the `--no-autosquash` enforcement/limitation in the
 * `getWantedCommitsWithBranchBoundariesUsingNativeGitRebase` function.
 *
 */
export async function autosquash(
	repo: Git.Repository, //
	extendedCommits: CommitAndBranchBoundary[]
): Promise<CommitAndBranchBoundary[]> {
	// type SHA = string;
	// const commitLookupTable: Map<SHA, Git.Commit> = new Map();

	const autoSquashableSummaryPrefixes = ["squash!", "fixup!"] as const;

	/**
	 * we want to re-order the commits,
	 * but we do NOT want the branches to follow them.
	 *
	 * the easiest way to do this is to "un-attach" the branches from the commits,
	 * do the re-ordering,
	 * and then re-attach the branches to the new commits that are previous to the branch.
	 */
	const unattachedCommitsAndBranches: UnAttachedCommitOrBranch[] = unAttachBranchesFromCommits(extendedCommits);

	for (let i = 0; i < unattachedCommitsAndBranches.length; i++) {
		const commitOrBranch: UnAttachedCommitOrBranch = unattachedCommitsAndBranches[i];

		if (isBranch(commitOrBranch)) {
			continue;
		}
		const commit: UnAttachedCommit = commitOrBranch;

		const summary: string = commit.commit.summary();
		const hasAutoSquashablePrefix = (prefix: string): boolean => summary.startsWith(prefix);

		const autoSquashCommandIdx: number = autoSquashableSummaryPrefixes.findIndex(hasAutoSquashablePrefix);
		const shouldBeAutoSquashed = autoSquashCommandIdx !== -1;

		if (!shouldBeAutoSquashed) {
			continue;
		}

		const command = autoSquashableSummaryPrefixes[autoSquashCommandIdx];
		const targetedCommittish: string = summary.split(" ")[1];

		/**
		 * https://libgit2.org/libgit2/#HEAD/group/revparse
		 */
		// Git.Revparse.ext(target, )
		const target: Git.Object = await Git.Revparse.single(repo, targetedCommittish);
		const targetRev: Git.Object = await target.peel(Git.Object.TYPE.COMMIT);
		const targetType: number = await targetRev.type();
		const targetIsCommit: boolean = targetType === Git.Object.TYPE.COMMIT;

		if (!targetIsCommit) {
			const msg =
				`\ntried to parse auto-squashable commit's target revision, but failed.` +
				`\ncommit = ${commit.commit.sha()} (${commit.commit.summary()})` +
				`\ncommand = ${command}` +
				`\ntarget = ${targetRev.id().tostrS()}` +
				`\ntarget type (expected ${Git.Object.TYPE.COMMIT}) = ${targetType}` +
				`\n\n`;

			throw new Termination(msg);
		}

		const indexOfTargetCommit: number = unattachedCommitsAndBranches.findIndex(
			(c) => !isBranch(c) && !target.id().cmp(c.commit.id())
		);
		const wasNotFound = indexOfTargetCommit === -1;

		if (wasNotFound) {
			const msg =
				`\ntried to re-order an auto-squashable commit, ` +
				`but the target commit was not within the commits that are being rebased.` +
				`\ncommit = ${commit.commit.sha()} (${commit.commit.summary()})` +
				`\ncommand = ${command}` +
				`\ntarget = ${targetRev.id().tostrS()}` +
				`\n\n`;

			throw new Termination(msg);
		}

		commit.commitCommand =
			command === "squash!"
				? "squash" //
				: command === "fixup!"
				? "fixup"
				: assertNever(command);

		/**
		 * first remove the commit from the array,
		 * and only then insert it in the array.
		 *
		 * this will always work, and the opposite will never work
		 * because of index mismatch:
		 *
		 * you cannot reference commit SHAs that will appear in the future,
		 * only in the past.
		 * thus, we know that an auto-squashable commit's target will always be
		 * earlier in the history than the auto-squashable commit itself.
		 *
		 * thus, we first remove the auto-squashable commit,
		 * so that the index of the target commit stays the same,
		 * and only then insert the auto-squashable commit.
		 *
		 *
		 * TODO optimal implementation with a linked list + a map
		 *
		 */
		unattachedCommitsAndBranches.splice(i, 1); // remove 1 element (`commit`)
		unattachedCommitsAndBranches.splice(indexOfTargetCommit + 1, 0, commit); // insert the `commit` in the new position
	}

	const reattached: CommitAndBranchBoundary[] = reAttachBranchesToCommits(unattachedCommitsAndBranches);

	return reattached;
}

type UnAttachedCommit = Omit<CommitAndBranchBoundary, "branchEnd">;
type UnAttachedBranch = Pick<CommitAndBranchBoundary, "branchEnd">;
type UnAttachedCommitOrBranch = UnAttachedCommit | UnAttachedBranch;

function isBranch(commitOrBranch: UnAttachedCommitOrBranch): commitOrBranch is UnAttachedBranch {
	return "branchEnd" in commitOrBranch;
}

function unAttachBranchesFromCommits(attached: CommitAndBranchBoundary[]): UnAttachedCommitOrBranch[] {
	const unattached: UnAttachedCommitOrBranch[] = [];

	for (const { branchEnd, ...c } of attached) {
		unattached.push(c);

		if (branchEnd?.length) {
			unattached.push({ branchEnd });
		}
	}

	return unattached;
}

/**
 * the key to remember here is that commits could've been moved around
 * (that's the whole purpose of unattaching and reattaching the branches)
 * (specifically, commits can only be moved back in history,
 *  because you cannot specify a SHA of a commit in the future),
 *
 * and thus multiple `branchEnd` could end up pointing to a single commit,
 * which just needs to be handled.
 *
 */
function reAttachBranchesToCommits(unattached: UnAttachedCommitOrBranch[]): CommitAndBranchBoundary[] {
	const reattached: CommitAndBranchBoundary[] = [];

	let branchEndsForCommit: NonNullable<UnAttachedBranch["branchEnd"]>[] = [];

	for (let i = unattached.length - 1; i >= 0; i--) {
		const commitOrBranch = unattached[i];

		if (isBranch(commitOrBranch) && commitOrBranch.branchEnd?.length) {
			/**
			 * it's a branchEnd. remember the above consideration
			 * that multiple of them can accumulate for a single commit,
			 * thus buffer them, until we reach a commit.
			 */
			branchEndsForCommit.push(commitOrBranch.branchEnd);
		} else {
			/**
			 * we reached a commit.
			 */

			let combinedBranchEnds: NonNullable<UnAttachedBranch["branchEnd"]> = [];

			/**
			 * they are added in reverse order (i--). let's reverse branchEndsForCommit
			 */
			for (let j = branchEndsForCommit.length - 1; j >= 0; j--) {
				const branchEnd: Git.Reference[] = branchEndsForCommit[j];
				combinedBranchEnds = combinedBranchEnds.concat(branchEnd);
			}

			const restoredCommitWithBranchEnds: CommitAndBranchBoundary = {
				...(commitOrBranch as UnAttachedCommit), // TODO TS assert
				branchEnd: [...combinedBranchEnds],
			};

			reattached.push(restoredCommitWithBranchEnds);
			branchEndsForCommit = [];
		}
	}

	/**
	 * we were going backwards - restore correct order.
	 * reverses in place.
	 */
	reattached.reverse();

	if (branchEndsForCommit.length) {
		/**
		 * TODO should never happen,
		 * or we should assign by default to the 1st commit
		 */

		const msg =
			`\nhave leftover branches without a commit to attach onto:` +
			`\n${branchEndsForCommit.join("\n")}` +
			`\n\n`;

		throw new Termination(msg);
	}

	return reattached;
}
