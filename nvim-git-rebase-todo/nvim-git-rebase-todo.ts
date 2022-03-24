import { NvimPlugin } from "neovim";

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
		"BufEnter",
		async (_fileName: string) => {
			await vim.buffer.append("BufEnter for git-rebase-todo File?");
			// await vim.window.
		},
		{ sync: false, pattern: "git-rebase-todo", eval: 'expand("<afile>")' }
	);
}
