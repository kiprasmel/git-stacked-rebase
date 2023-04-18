import readline from "readline";

export const createQuestion =
	(
		rl = readline.createInterface(process.stdin, process.stdout) //
	) =>
	(
		q: string //
	): Promise<string> =>
		new Promise<string>((r) =>
			rl.question(q, (ans) => {
				rl.close();
				r(ans);
			})
		);

export type AskQuestion = typeof question;

export const question = (
	q: typeof Questions[keyof typeof Questions] | (string & {}), //
	{
		prefix = "\n", //
		suffix = "",
		cb = (ans: string): string => ans,
	} = {}
): string | Promise<string> => createQuestion()(prefix + q + suffix).then(cb);

export const Questions = {
	need_to_apply_before_continuing: "need to --apply before continuing. proceed? [Y/n/(a)lways] ", //
	commit_has_multiple_branches_pointing_at_it__which_to_use_for_pr_stack: `Which branch to use for the PR stack? `,
	open_urls_in_web_browser: "Open URLs in default web browser? [Y/n/(a)lways] ",
} as const;

/**
 * ---
 */

export type AskWhichBranchEndToUseForStackedPRsCtx = {
	branchEnds: string[];
	commitSha: string;
	askQuestion: AskQuestion;
};
export async function askWhichBranchEndToUseForStackedPRs({
	branchEnds, //
	commitSha,
	askQuestion,
}: AskWhichBranchEndToUseForStackedPRsCtx) {
	const prefix: string =
		`\nCommit: ${commitSha}` +
		`\nBranch:` +
		"\n" +
		branchEnds.map((branch, idx) => `[${idx + 1}] ${branch}`).join("\n") +
		`\n` +
		`\nAbove commit has multiple branches pointing at it.` +
		`\n`;

	const suffix: string = `Choose a number 1-${branchEnds.length}: `;

	let rawAnswer: string;
	let chosenBranchIdx: number;

	process.stdout.write(prefix);

	do {
		const ctx = { prefix: "", suffix };
		rawAnswer = await askQuestion(
			Questions.commit_has_multiple_branches_pointing_at_it__which_to_use_for_pr_stack,
			ctx
		);
		chosenBranchIdx = Number(rawAnswer) - 1;
	} while (!isGoodAnswer());

	function isGoodAnswer(): boolean {
		if (!rawAnswer?.trim()) return false;
		if (Number.isNaN(chosenBranchIdx)) return false;
		if (chosenBranchIdx < 0) return false;
		if (chosenBranchIdx >= branchEnds.length) return false;

		return true;
	}

	const chosenBranch: string = branchEnds[chosenBranchIdx];

	process.stdout.write(`${chosenBranch}\n`);
	return chosenBranch;
}
