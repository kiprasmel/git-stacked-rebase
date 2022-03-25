// import fs from "fs";

import { NvimPlugin } from "neovim";

/**
 * TODO `console.log`s break stuff
 */

export default function nvimGitRebaseTodo(plugin: NvimPlugin): void {
	const { nvim: vim } = plugin;

	plugin.setOptions({ dev: false });

	plugin.registerCommand(
		"EchoMessage",
		async () => {
			try {
				await vim.outWrite("Dayman (ah-ah-ah) \n");
			} catch (err) {
				console.error(err);
			}
		},
		{ sync: false }
	);

	plugin.registerFunction(
		"SetLines",
		() =>
			vim
				.setLine("May I offer you an egg in these troubling times")
				.then(() => console.log("Line should be set")),
		{ sync: false }
	);

	plugin.registerAutocmd(
		/**
		 * :help events
		 *
		 * CursorMoved?
		 */
		"BufEnter",
		async (_fileName: string) => {
			await vim.buffer.append("BufEnter for git-rebase-todo File?");
			// const w = new vim.Window({});
			// w.setOption("width", 10);
			//
			// const w = await vim.window;
			// console.log(w);
		},
		{ sync: false, pattern: "git-rebase-todo", eval: 'expand("<afile>")' }
	);

	// plugin.registerAutocmd(
	// 	/**
	// 	 * :help events
	// 	 *
	// 	 * CursorMoved?
	// 	 */
	// 	"CursorMoved",
	// 	async (_fileName: string) => {
	// 		// await vim.buffer.append("BufEnter for git-rebase-todo File?");
	// 		// const w = new vim.Window({});
	// 		// w.setOption("width", 10);
	// 		// const w = await vim.window;
	// 		// eslint-disable-next-line prefer-rest-params
	// 		// console.log("cursor moved!", arguments);
	// 	},
	// 	{ sync: false, pattern: "git-rebase-todo", eval: 'expand("<afile>")' }
	// );
}
