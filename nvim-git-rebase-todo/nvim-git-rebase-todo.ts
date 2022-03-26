/* eslint-disable indent */

import cp from "child_process";
import util from "util";

import { NvimPlugin, Buffer, Window } from "neovim";
import { OpenWindowOptions } from "neovim/lib/api/Neovim";

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
	 * TODO make actually configurable
	 */
	const config = {
		colorful: false,
		minHeight: 3,
		maxWidth: 60,
		fixedWidth: 60,
		showStatParsingCount: false,
		relativeToCursor: false,
	};

	let gBuffer: Buffer;
	let gWindow: Window;

	const initBuffer = async (): Promise<Buffer> => {
		const listed = false;
		const scratch = true;
		const buffer: number | Buffer = await vim.createBuffer(listed, scratch);

		if (typeof buffer === "number") {
			throw new Error("failed to create buffer");
		}

		gBuffer = buffer;
		return buffer;
	};

	const updateBuffer = async (stat: string[]): Promise<Buffer> => {
		if (!gBuffer) {
			await initBuffer();
		}

		await gBuffer.setLines(stat, {
			start: 0,
			/**
			 * TODO why is the below broken & below below works?
			 */
			// end: Math.max(stat.length, (await gBuffer.lines).length), // needed to remove old lines
			end: (await gBuffer.lines).length, // needed to remove old lines
		});

		return gBuffer;
	};

	const hideWindow = async (): Promise<void> => {
		/**
		 * overkill
		 */
		// if (!gWindow) {
		// 	return;
		// }
		// const force = true;
		// await gWindow.close(force);
		// gWindow = null as any; // TODO

		/**
		 * does NOT work
		 */
		// await vim.windowConfig(gWindow, {
		// 	width: 0,
		// 	height: 0,
		// });

		/**
		 * works
		 */
		gWindow.width = 0;
		gWindow.height = 0;
	};

	type WH = {
		width: number;
		height: number;
	};

	type SetWindowRelativeToCursorOpts = WH;
	const getRelativeWindowOptions = async ({
		width, //
		height,
	}: SetWindowRelativeToCursorOpts): Promise<OpenWindowOptions> => {
		/**
		 * TODO REFACTOR - the "relative to cursor" behavior
		 * should be applied when initializing as well
		 * it's not noticable because you always start at row 0,
		 * (unless if you come from another buffer!
		 *  but probably unlikely since by that point
		 *  would already be initialized?
		 *
			 * 
		 *
		 *  or we .close our gWindow so still matters?)
		 *
			 * 
		 *
		 */

		const cursor = await vim.window.cursor;

		// const row = await vim.window.row;
		// const col = await vim.window.col;

		const relWin = await vim.window;
		// const [row, _col] = await relWin.cursor;

		return {
			// relative: "cursor",
			relative: "win" as const,
			win: relWin as any,
			// row: row - 1,
			// col: col,
			// col: await relWin.width,
			bufpos: cursor,
			row: -1, // TODO investigate when in very last row & fully scrolled down with Ctrl-E
			// col: 20,
			col: await relWin.width,
			width,
			height,
			//
			style: "minimal",
		};
		// await vim.windowConfig(gWindow,);

		// ? ({
		// 		// relative: "win",
		// 		// win: relWin.id,
		// 		// relative: "cursor",
		// 		//
		// 		width,
		// 		height,
		// 		//
		// 		// anchor: "NE", // TODO is this needed?
		// 		row: 0,
		// 		// row: relWinHeight,
		// 		col: relWinWidth,

		// 		//
		// 		style: "minimal",
		//   } as const)

		// gWindow.row = _row;
		// await gWindow.setOption("row", _row);
		// gWindow.cursor = cursor;
		// gWindow.width = _row;

		// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
		// @ts-ignore
		// gWindow.row = _row;
	};

	type InitWindowOpts = WH & {
		buffer: Buffer;
	};

	const initWindow = async ({ buffer, width, height }: InitWindowOpts): Promise<void> => {
		/**
		 * TODO update the buffer here w/ `stat` (`lines`)
		 * instead of taking it in as param
		 */

		const relWin: Window = await vim.getWindow();

		const relWinWidth: number = await relWin.width;
		// const relWinHeight: number = await gRelWin.height;

		const enter = false;

		const opts: OpenWindowOptions = config.relativeToCursor
			? {
					...(await getRelativeWindowOptions({ width, height })),
			  }
			: ({
					relative: "win",
					win: relWin.id,
					//
					width,
					height,
					//
					// anchor: "NE", // TODO is this needed?
					row: 0,
					col: relWinWidth,
					//
					style: "minimal",
			  } as const);

		const window: number | Window = await vim.openWindow(buffer, enter, opts);

		if (typeof window === "number") {
			throw new Error("failed to create window");
		}

		gWindow = window;
	};

	const updateWindow = async ({ buffer, width, height }: InitWindowOpts): Promise<void> => {
		if (!gWindow) {
			await initWindow({
				buffer,
				width,
				height, //
			});
		}

		/**
		 * TODO REFACTOR
		 */
		// if (width === 0 && height === 0 && !config.relativeToCursor) {
		if (width === 0 && height === 0) {
			await hideWindow();
		} else {
			if (config.relativeToCursor) {
				const opts = await getRelativeWindowOptions({
					width, //
					height,
				});
				await vim.windowConfig(gWindow, opts);
			} else {
				gWindow.width = width;
				gWindow.height = height;

				// await vim.windowConfig(gWindow, {
				// 	relative: "win",
				// 	win: relWin,
				// 	// row: row - 1,
				// 	// col: col,
				// 	// col: await relWin.width,
				// 	row: 0,
				// 	// col: 0,
				// 	col: await relWin.width,
				// 	width,
				// 	height,
				// });
			}
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
	/**
	 * TODO consider an option where we precompute stats for all commits,
	 * set the window to the the longest height out of them,
	 * and keep the changed files aligned across committish lines,
	 * so that it's even more obvious what changed vs what not.
	 *
	 * could even show all filenames together,
	 * but the non-changed ones with less contrast
	 *
	 */
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

		if (config.showStatParsingCount) {
			stat.unshift((count++).toString());
		}

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

			const buffer: Buffer = await updateBuffer(lines); //
			await updateWindow({
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
		// const height: number = Math.max(stat.length, config.minHeight);
		const height: number = Math.max(stat.length, config.minHeight + Number(!!config.showStatParsingCount));

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
			// await initWindow({ width, height });
			await drawLinesOfCommittishStat();
		},
		{ sync: false, pattern: pattern, eval: 'expand("<afile>")' }
	);

	plugin.registerAutocmd(
		"BufLeave",
		async () => {
			await hideWindow();
		},
		{
			sync: false,
			pattern: pattern,
			eval: 'expand("<afile>")',
		}
	);

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
