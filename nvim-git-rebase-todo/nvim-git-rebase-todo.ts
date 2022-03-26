// import fs from "fs";
import cp from "child_process";
import util from "util";

import { NvimPlugin, Buffer, Window } from "neovim";

const execAsync = util.promisify(cp.exec);

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

	/**
	 * TODO actually configurable
	 */
	const config = {
		minHeight: 3,
		colorful: false,
		maxWidth: 60,
		fixedWidth: 60,
	};

	let gBuffer: Buffer;
	let gWindow: Window;

	const initBufferAsync = async (): Promise<Buffer> => {
		const listed = false;
		const scratch = true;
		const buffer: number | Buffer = await vim.createBuffer(listed, scratch);

		if (typeof buffer === "number") {
			throw new Error("failed to create buffer");
		}

		gBuffer = buffer;
		return buffer;
	};

	const updateBufferAsync = async (stat: string[]): Promise<Buffer> => {
		if (!gBuffer) {
			await initBufferAsync();
		}

		await gBuffer.setLines(stat, {
			start: 0,
			/** TODO why is the below broken & below below works? */
			// end: Math.max(stat.length, prevEnd), // needed to remove old lines
			end: (await gBuffer.lines).length, // needed to remove old lines
		});

		return gBuffer;
	};

	type InitWindowOpts = {
		buffer: Buffer;
		width: number;
		height: number;
	};

	const initWindowAsync = async ({ buffer, width, height }: InitWindowOpts): Promise<void> => {
		/**
		 * TODO update the buffer here w/ `stat` (`lines`)
		 * instead of taking it in as param
		 */

		const relWin: Window = await vim.getWindow();

		const relWinWidth: number = await relWin.width;
		// const relWinHeight: number = await gRelWin.height;

		const enter = false;
		const window: number | Window = await vim.openWindow(buffer, enter, {
			relative: "win",
			win: relWin.id,
			//
			width,
			height,
			//
			// anchor: "NE", // TODO is this needed?
			row: 0,
			// row: relWinHeight,
			col: relWinWidth,
			//
			style: "minimal",
		});

		if (typeof window === "number") {
			throw new Error("failed to create window");
		}

		gWindow = window;
	};

	const updateWindowAsync = async ({ buffer, width, height }: InitWindowOpts): Promise<void> => {
		if (!gWindow) {
			await initWindowAsync({
				buffer,
				width,
				height, //
			});
		} else {
			gWindow.width = width;
			gWindow.height = height;
		}
	};

	/**
	 *
	 */

	const getCommittishOfCurrentLine = async (): Promise<Committish> => {
		// const line: string | null = await new Promise<string>((r) => r(vim.line)).catch(() => null);
		// const line: string | null = await new Promise<string>((r) => r(vim.line)).catch(() => null);
		// console.log({ line });

		let line: string | null;
		try {
			line = await vim.line;
		} catch {
			return null;
		}

		if (!line || typeof line !== "string") {
			return null;
		}

		const split = line.split(" ");
		const wantedIdx: number = 1;

		if (split.length < wantedIdx + 1) {
			return null;
		}

		const committish: string | undefined = split[wantedIdx];

		if (typeof committish !== "string") {
			return null;
		}

		return committish;
	};
	// /**
	//  * TODO make private, allow to be changed only in `drawLinesOfCommittishStat`
	//  * (factory fn),
	//  * and create a getter fn to allow comparing
	//  */
	// let gCommittish: null | string = null;

	let count: number = 0;
	const getStatLines = async (committish: NonNullable<Committish>): Promise<string[]> => {
		// const gitShowCmd: string = `git show --stat ${committish}`;
		/**
		 * remove everything except the `/path/to/file | N +-`
		 */
		const gitShowCmd: string = [
			"git",
			"show",
			committish,
			`--stat=${config.maxWidth}`, // [[1]]
			"--pretty=format:''",
			config.colorful ? "--color=always" : "", // TODO proper impl with vim
			"| head -n -1" /** remove last item (X files changed, Y insertions, Z deletions) */,
		].join(" ");

		const stat: string[] = await execAsync(gitShowCmd, { encoding: "utf-8" }).then((x) =>
			x.stderr ? [] : x.stdout.split("\n")
		);
		if (!stat.length) {
			return [];
		}

		stat.unshift((count++).toString());

		return stat;
	};

	// type DrawLinesOfCommittishStatRet = {
	// 	width: number;
	// 	height: number;

	// 	committish: string | null;

	// 	bufStart: number;
	// 	bufEnd: number;
	// };

	// let previousState: DrawLinesOfCommittishStatRet | null = null;

	// const drawLinesOfCommittishStat = async (): Promise<DrawLinesOfCommittishStatRet> => {

	type Committish = string | null;
	let previousCommittish: Committish;

	const drawLinesOfCommittishStat = async (): Promise<Committish> => {
		const committish: Committish = await getCommittishOfCurrentLine();

		if (committish === previousCommittish) {
			return previousCommittish;
		}

		/**
		 * TODO OPTIMIZE
		 */
		const commitState = async (opts: Omit<InitWindowOpts, "buffer"> & { lines: string[] }): Promise<Committish> => {
			const { lines, ...rest } = opts;

			const buffer: Buffer = await updateBufferAsync(lines); //
			await updateWindowAsync({
				buffer,
				...rest,
			});

			previousCommittish = committish;
			return committish;
		};

		if (!committish) {
			return commitState({
				lines: [],
				width: 0,
				height: 0,
			});
		}

		const stat: string[] = await getStatLines(committish);

		if (!stat.length) {
			return commitState({
				lines: [],
				width: 0,
				height: 0,
			});
		}

		const longestLineLength: number = stat.reduce((max, curr) => Math.max(max, curr.length), 0);

		if (longestLineLength === 0) {
			return commitState({
				lines: [],
				width: 0,
				height: 0,
			});
		}

		/**
		 * config.maxWidth shouldn't be needed here,
		 * since it's being limited in [[1]]
		 */
		const width: number = config.fixedWidth ?? longestLineLength;

		/**
		 * TODO could parse whole git-rebase-todo file, find the max height,
		 * and use it, so that we never encounter any jumping.
		 *
		 * could even allow configuring this behavior.
		 */
		const height: number = Math.max(stat.length, config.minHeight);

		return commitState({
			lines: stat,
			width,
			height,
		});
	};

	const pattern = "git-rebase-todo" as const;

	plugin.registerAutocmd(
		/**
		 * :help events
		 *
		 * CursorMoved?
		 */
		"BufEnter",
		async (_fileName: string) => {
			// await vim.buffer.append("BufEnter for git-rebase-todo File?");
			// const w = new vim.Window({});
			// w.setOption("width", 10);
			//
			// const w = await vim.window;
			// console.log(w);

			// const { width, height } = await drawLinesOfCommittishStat();
			// await initWindowAsync({ width, height });
			await drawLinesOfCommittishStat();
		},
		{ sync: false, pattern: pattern, eval: 'expand("<afile>")' }
	);

	// plugin.registerAutocmd(
	// 	"BufLeave",
	// 	async () => {
	// 		if (!gOurWindow) {
	// 			return;
	// 		}

	// 		const force = true;
	// 		await (gOurWindow as Window).close(force);
	// 		// gOurWindow = null;
	// 	},
	// 	{
	// 		sync: false,
	// 		pattern: pattern,
	// 		eval: 'expand("<afile>")',
	// 	}
	// );

	/**
	 * :help events
	 */
	plugin.registerAutocmd(
		"CursorMoved",
		() => {
			drawLinesOfCommittishStat();
		},
		{ sync: false, pattern: pattern, eval: 'expand("<afile>")' }
	);

	/**
	 * only needed when you create a new line,
	 * otherwise could get rid...
	 *
	 * TODO OPTIMIZE
	 */
	plugin.registerAutocmd(
		"CursorMovedI",
		() => {
			drawLinesOfCommittishStat();
		},
		{ sync: false, pattern: pattern, eval: 'expand("<afile>")' }
	);
}
