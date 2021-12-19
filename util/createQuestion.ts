import readline from "readline";

export const createQuestion = (
	rl = readline.createInterface(process.stdin, process.stdout) //
) => (
	q: string //
): Promise<string> =>
	new Promise<string>((r) =>
		rl.question(q, (ans) => {
			r(ans);
		})
	);
