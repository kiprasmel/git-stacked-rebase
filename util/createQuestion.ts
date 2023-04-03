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
				r(ans);
			})
		);

export type AskQuestion = typeof question;

export const question = (
	q: string, //
	cb: (ans: string) => string = (ans) => ans,
	{ prefix = "\n" } = {}
): string | Promise<string> => createQuestion()(prefix + q).then(cb);

export const Questions = {
	need_to_apply_before_continuing: "need to --apply before continuing. proceed? [Y/n/(a)lways] ", //
} as const;
