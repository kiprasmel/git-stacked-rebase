/* eslint-disable indent */
/* eslint-disable no-cond-assign */

import cp from "child_process";
import util from "util";

import { NvimPlugin, Buffer, Window } from "neovim";
import { OpenWindowOptions } from "neovim/lib/api/Neovim";
import { AutocmdOptions } from "neovim/lib/host/NvimPlugin";

const execAsync = util.promisify(cp.exec);

/**
 * TODO `console.log`s break stuff
 */

export default function nvimGitRebaseTodo(plugin: NvimPlugin): void {
	/**
	 * TODO make actually configurable
	 */
	const config = {
		colorful: false,
		minHeight: 3,
		maxWidth: 60,
		fixedWidth: 60,
		showStatParsingCount: false,
		showCacheHitOrMiss: false,

		// relativeToCursor: true,
		// closeToLeft: 5,
		// rowLowerIfCloseToLeft: 1,
		relativeToCursor: false,
		closeToLeft: 0,
		rowLowerIfCloseToLeft: 0,
	};

	/**
	 *
	 */

	const { nvim: vim } = plugin;

	plugin.setOptions({ dev: false });

	const pattern = "git-rebase-todo" as const;
	const commonOptions: AutocmdOptions = {
		sync: false, //
		pattern,
		eval: 'expand("<afile>")', // i don't know what this does
	};

	/**
	 * :help events
	 */
	plugin.registerAutocmd(
		"BufEnter", //
		() => drawLinesOfCommittishStat(),
		{
			...commonOptions,
		}
	);

	plugin.registerAutocmd(
		"BufLeave", //
		() => hideWindow(),
		{
			...commonOptions,
		}
	);

	plugin.registerAutocmd(
		"CursorMoved", //
		() => drawLinesOfCommittishStat(),
		{
			...commonOptions,
		}
	);

	/**
	 * only needed when you create a new line,
	 * otherwise could get rid...
	 *
	 * TODO OPTIMIZE
	 */
	plugin.registerAutocmd(
		"CursorMovedI", //
		() => drawLinesOfCommittishStat(),
		{
			...commonOptions,
		}
	);

	/**
	 *
	 */

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
		const cursor = await vim.window.cursor;

		const relWin = await vim.window;
		const col: number = config.closeToLeft || (await relWin.width);

		return {
			// relative: "cursor",
			relative: "win" as const,
			win: (relWin as unknown) as number, // TODO TS fix incorrect types @ upstream
			//
			bufpos: cursor,
			//
			row: -1 + (config.closeToLeft ? config.rowLowerIfCloseToLeft : 0), // TODO investigate when in very last row & fully scrolled down with Ctrl-E
			col,
			//
			width,
			height,
			//
			style: "minimal",
		};
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
		const col: number = config.closeToLeft || (await relWin.width);

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
					row: 0 + (config.closeToLeft ? config.rowLowerIfCloseToLeft : 0),
					col,
					//
					style: "minimal",
			  } as const);

		const enter = false;
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
		 * the `hideWindow` should be a prop probably,
		 * instead of implying it like this w/ `0x0`
		 */
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
			}
		}
	};

	/**
	 *
	 */

	const getCommittishOfCurrentLine = async (): Promise<Committish> => {
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

	let gParseStatCount: number = 0;
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
			/**
			 * if stderr, it's an error.
			 * TODO ideally would be more explicit,
			 * i.e. "hideWindow" or smthn
			 */
			x.stderr //
				? []
				: x.stdout.split("\n")
		);

		gParseStatCount++;

		if (!stat.length) {
			return [];
		}

		return stat;
	};

	type Committish = string | null;
	type State = {
		committish: Committish;

		/**
		 * will not include the extra "informational" lines;
		 * use `getExtraInfoLines` for that.
		 */
		lines: string[];

		width: number;
		height: number;
	};
	type CommitStateOpts = {
		isCacheHit: boolean; //
	};

	let prevState: State | null = null;
	const committishToStatCache: Map<NonNullable<Committish>, State> = new Map();
	const commitState = (
		state: State,
		{
			isCacheHit = false, //
		}: Partial<CommitStateOpts> = {}
	): Promise<State> =>
		Promise.resolve()
			.then((): string[] => [
				...getExtraInfoLines({ isCacheHit }),
				...state.lines, // do not mutate state.lines
			])
			.then((lines) => updateBuffer(lines))
			.then((buffer) =>
				updateWindow({
					buffer, //
					width: state.width,
					height: state.height,
				})
			)
			.then(() => state.committish && committishToStatCache.set(state.committish, state))
			.then(() => (prevState = state));

	function getExtraInfoLines(opts: CommitStateOpts): string[] {
		const extra: string[] = [];

		if (config.showStatParsingCount) {
			extra.push(gParseStatCount.toString());
		}
		if (config.showCacheHitOrMiss && opts.isCacheHit) {
			extra.push("cache hit");
		}

		return extra;
	}

	const drawLinesOfCommittishStat = async (): Promise<State> => {
		const committish: Committish = await getCommittishOfCurrentLine();

		if (committish === prevState?.committish) {
			return prevState;
		}

		if (!committish) {
			return commitState({
				committish,
				lines: [],
				width: 0,
				height: 0,
			});
		}

		let tmp: State | undefined;
		if ((tmp = committishToStatCache.get(committish))) {
			return commitState(tmp, {
				isCacheHit: true, //
			});
		}

		const stat: string[] = await getStatLines(committish);

		if (!stat.length) {
			return commitState({
				committish,
				lines: [],
				width: 0,
				height: 0,
			});
		}

		const longestLineLength: number = stat.reduce((max, curr) => Math.max(max, curr.length), 0);

		if (longestLineLength === 0) {
			return commitState({
				committish,
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
			committish,
			lines: stat,
			width,
			height,
		});
	};
}
