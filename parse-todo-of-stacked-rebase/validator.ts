/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable indent */

import { assert } from "console";
import { bullets, joinWith, joinWithIncludingFirstLast, tick } from "nice-comment";
import { EitherExit, fail, succ } from "../util/Exitable";

/**
 * if invalid, should fill the array with reasons why not valid.
 */
type Validator = (ctx: { rest: string; reasonsIfBad: string[] }) => boolean;

type ParseTargets = (ctx: {
	line: string; //
	split: string[];
	rest: string;
}) => string[] | null;

type Command = {
	/**
	 * be careful with aliases
	 */
	maxUseCount: number;
	isRestValid: Validator;
	// alwaysHasSha: boolean; // TODO: parseTarget (everyone has except `break`)
	nameOrAlias: EitherRebaseEitherCommandOrAlias;
	parseTargets: ParseTargets;
};

const createCommand = (
	nameOrAlias: string,
	{
		parseTargets = ({ split }) => {
			assert(
				split.length >= 2,
				"command must contain at least 2 words. otherwise, implement a custom target parser."
			);

			return [split[1]];
		},
		maxUseCount = Infinity,
		isRestValid = () => true,
	}: {
		// nameOrAlias: EitherRebaseEitherCommandOrAlias, //
		parseTargets?: Command["parseTargets"];
		maxUseCount?: number;
		isRestValid?: Validator;
	} = {}
): Command => ({
	maxUseCount,
	isRestValid,
	// nameOrAlias: nameOrAlias,
	nameOrAlias: nameOrAlias as EitherRebaseEitherCommandOrAlias, // TODO: TS
	parseTargets,
});

export const regularRebaseCommands = {
	pick: createCommand("pick"),
	// p: standardCommand,
	reword: createCommand("reword"),
	// r: standardCommand,
	edit: createCommand("edit"),
	// e: standardCommand,
	squash: createCommand("squash"),
	// s: standardCommand,
	fixup: createCommand("fixup", {
		parseTargets: ({ split }) => {
			/**
			 * TODO: add metadata about -C|-c
			 */
			if (["-C", "-c"].includes(split[1])) {
				assert(split.length >= 4);
				return [split[2]];
			}

			assert(split.length >= 3);
			return [split[1]];
		},
	}),
	// f: standardCommand,
	exec: createCommand("exec", { parseTargets: ({ rest }) => [rest] }),
	// x: standardCommand,
	break: createCommand("break", { parseTargets: () => null }),
	// b: standardCommand,
	drop: createCommand("drop"),
	// d: standardCommand,
	label: createCommand("label"),
	// l: standardCommand,
	reset: createCommand("reset"),
	// t: standardCommand,
	merge: createCommand("merge", {
		parseTargets: ({ split }) => {
			if (["-C", "-c"].includes(split[1])) {
				assert(split.length >= 4 /** not sure if 5 */);
				if (split.length >= 5) {
					/** commit, label, oneline */
					return [split[2], split[3], split[4]];
				} else {
					/** commit, label */
					return [split[2], split[3]];
				}
			} else {
				assert(split.length >= 2);

				if (split.length >= 3) {
					/** label, oneline */
					return [split[1], split[2]];
				} else {
					/** label */
					return [split[1]];
				}
			}
		},
	}),
	// m: standardCommand,
} as const;

type RegularRebaseCommand = keyof typeof regularRebaseCommands;

/**
 * TODO: assert each value is `RegularRebaseCommand`,
 * without losing the exact type.
 */
const regularRebaseCommandAliases = {
	p: "pick",
	r: "reword",
	e: "edit",
	s: "squash",
	f: "fixup",
	x: "exec",
	b: "break",
	d: "drop",
	l: "label",
	t: "reset",
	m: "merge",
} as const;

type RegularRebaseCommandAlias = keyof typeof regularRebaseCommandAliases;

const branchValidator: Validator = ({ rest, reasonsIfBad: reasonsWhyInvalid }) => {
	const origLen = reasonsWhyInvalid.length;

	const isSpaceless = rest.split(" ").filter((word) => !!word).length === 1;
	if (!isSpaceless) {
		reasonsWhyInvalid.push("branch name contains spaces");
	}

	if (rest.length >= 128) {
		reasonsWhyInvalid.push("branch name contains >=128 characters - some systems can produce undefined behavior");
	}

	/**
	 * TODO other validations, e.g. characters, etc
	 */

	return !(reasonsWhyInvalid.length - origLen);
};

export const stackedRebaseCommands = {
	"branch-end": createCommand("branch-end", {
		maxUseCount: Infinity,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
	"branch-end-new": createCommand("branch-end-new", {
		maxUseCount: Infinity,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
	"branch-end-initial": createCommand("branch-end-initial", {
		maxUseCount: 1,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
	"branch-end-last": createCommand("branch-end-last", {
		maxUseCount: 1,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
} as const;

type StackedRebaseCommand = keyof typeof stackedRebaseCommands;

// const allowedCommandAliasesFromGitStackedRebase: { [key: string]: AllowedGitStackedRebaseCommand } = {
const stackedRebaseCommandAliases = {
	be: "branch-end",
	ben: "branch-end-new",
} as const;

type StackedRebaseCommandAlias = keyof typeof stackedRebaseCommandAliases;

type EitherRebaseCommand = RegularRebaseCommand | StackedRebaseCommand;
type EitherRebaseCommandAlias = RegularRebaseCommandAlias | StackedRebaseCommandAlias;

type EitherRebaseEitherCommandOrAlias = EitherRebaseCommand | EitherRebaseCommandAlias;

type MapOfAllowedRebaseCommands = {
	[key in EitherRebaseCommand]: Command;
};

const allEitherRebaseCommands: MapOfAllowedRebaseCommands = {
	...regularRebaseCommands,
	...stackedRebaseCommands,
};

const allEitherRebaseCommandAliases = {
	...regularRebaseCommandAliases,
	...stackedRebaseCommandAliases,
} as const;

// type MapOfAllowedRebaseCommandAliases = {
// 	[key in AllowedRebaseCommandAlias]: CommandAlias;
// };

type BadCommand = {
	command: string;
	lineNumber: number;
	fullLine: string;
	reasons: string[];
};

export type GoodCommand = {
	commandOrAliasName: EitherRebaseEitherCommandOrAlias;
	lineNumber: number;
	fullLine: string;
	rest: string;
	/**
	 * SHA or branch or label (all commands, except `break`, have >=1)
	 * TODO: handle >1
	 */
	targets: string[] | null;
	index: number;

	// commandName: EitherRebaseCommand;
} & (
	| {
			rebaseKind: "regular";
			commandName: RegularRebaseCommand;
	  }
	| {
			rebaseKind: "stacked";
			commandName: StackedRebaseCommand;
			commitSHAThatBranchPointsTo: string | null;
	  }
);

export function validate(linesOfEditedRebaseTodo: string[]): EitherExit<GoodCommand[]> {
	const badCommands: BadCommand[] = [];
	const goodCommands: GoodCommand[] = [];

	type CommandUsedAtLines = {
		[key in EitherRebaseCommand]: MapOfAllowedRebaseCommands[key] extends { maxUseCount: number }
			? number[]
			: never;
	};

	const commandUsedAtLines: CommandUsedAtLines = Object.fromEntries<number[]>(
		Object.keys(allEitherRebaseCommands).map((
			key //
		) => [key, []])
		//
	) as CommandUsedAtLines; // too bad TS cannot infer Object.keys & Object.fromEntries...

	// eslint-disable-next-line no-inner-declarations
	function commandOrAliasExists(command: string): command is EitherRebaseEitherCommandOrAlias {
		return command in allEitherRebaseCommands || command in allEitherRebaseCommandAliases;
	}

	let previousCommitSHA: string | null;
	/**
	 * we're not processing command-by-command, we're processing line-by-line.
	 */
	linesOfEditedRebaseTodo.forEach((fullLine, index) => {
		const [commandOrAliasName, ..._rest] = fullLine.split(" ");
		const rest = _rest.join(" ");

		const lineNumber: number = index + 1;

		if (!commandOrAliasExists(commandOrAliasName)) {
			badCommands.push({
				command: commandOrAliasName,
				lineNumber,
				fullLine,
				reasons: ["unrecognized command"],
			});

			return;
		}

		const commandName: EitherRebaseCommand =
			commandOrAliasName in regularRebaseCommandAliases
				? regularRebaseCommandAliases[commandOrAliasName as RegularRebaseCommandAlias]
				: commandOrAliasName in stackedRebaseCommandAliases
				? stackedRebaseCommandAliases[commandOrAliasName as StackedRebaseCommandAlias]
				: (commandOrAliasName as StackedRebaseCommand);

		commandUsedAtLines[commandName].push(lineNumber);

		const reasonsIfBad: string[] = [];

		if (index === 0) {
			if (commandName !== "branch-end-initial") {
				reasonsIfBad.push("initial command must be `branch-end-initial`");
			}
		}
		if (index === linesOfEditedRebaseTodo.length - 1) {
			if (commandName !== "branch-end-last") {
				reasonsIfBad.push("last command must be `branch-end-last`");
			}
		}

		if (commandUsedAtLines[commandName].length > allEitherRebaseCommands[commandName].maxUseCount) {
			reasonsIfBad.push(
				joinWith(" ")([
					"command was used more times than allowed",
					`(max allowed =`,
					`${allEitherRebaseCommands[commandName].maxUseCount},`,
					`used =`,
					`${commandUsedAtLines[commandName].length},`,
					`first used = line ${commandUsedAtLines[commandName][0]})`,
				])
			);
		}

		const command: Command = allEitherRebaseCommands[commandName];

		command.isRestValid({ rest, reasonsIfBad });

		const targets: string[] | null = command.parseTargets({
			line: fullLine, //
			split: fullLine.split(" ").filter((word) => !!word),
			rest,
		});

		if (reasonsIfBad.length) {
			badCommands.push({
				command: commandName,
				lineNumber,
				fullLine,
				reasons: reasonsIfBad,
			});
		} else {
			goodCommands.push({
				commandOrAliasName,
				targets,
				index,
				lineNumber,
				fullLine,
				rest,
				...(commandName in regularRebaseCommands
					? {
							rebaseKind: "regular",
							commandName: commandName as RegularRebaseCommand,
					  }
					: commandName in stackedRebaseCommands
					? {
							rebaseKind: "stacked",
							commandName: commandName as StackedRebaseCommand,
							commitSHAThatBranchPointsTo: previousCommitSHA,
					  }
					: (() => {
							throw new Error("never");
					  })()),
			});

			if (commandName in regularRebaseCommands) {
				previousCommitSHA = targets?.[0] ?? null;
			}
		}
	});

	if (badCommands.length) {
		return fail(
			joinWithIncludingFirstLast("\n\n")([
				"found errors in rebase commands:",
				...badCommands.map((cmd) =>
					bullets(`  line ${cmd.lineNumber}: ${tick(cmd.command)}`, cmd.reasons, "     - ")
				),
				"to edit & fix, use:",
				"  git-stacked-rebase -e|--edit-todo\n",
			]).slice(1)
		);
	}

	return succ(goodCommands);
}
