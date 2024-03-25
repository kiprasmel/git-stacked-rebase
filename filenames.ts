/**
 * both their & ours.
 */
export const filenames = {
	rewrittenList: "rewritten-list",
	willNeedToApply: "will-need-to-apply",
	needsToApply: "needs-to-apply",
	applied: "rewritten-list.applied",
	//
	gitRebaseTodo: "git-rebase-todo",
	//
	postStackedRebaseHook: "post-stacked-rebase",
	//
	initialBranch: "initial-branch",

	/**
	 * TODO extract others into here
	 */
} as const;

export const FILENAMES_THAT_INDICATE_STACKED_REBASE_IN_PROGRESS = [
	filenames.rewrittenList,
	filenames.willNeedToApply,
	filenames.needsToApply,
	filenames.applied,
	filenames.gitRebaseTodo,
];
