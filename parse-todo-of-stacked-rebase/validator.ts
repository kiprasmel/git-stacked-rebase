/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable indent */

import assert from "assert";
import { bullets, joinWith, tick } from "nice-comment";
import { Termination } from "../util/error";

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
	nameButNeverAlias: EitherRebaseCommand;
	parseTargets: ParseTargets;

	makesGitRebaseExitToPause: boolean;
};

const createCommand = (
	nameButNeverAlias: string,
	{
		makesGitRebaseExitToPause,
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
		/**
		 * such exit is usually when a user wants to do manual action,
		 * i.e. something that needs to be followed up by
		 * `git rebase --continue`,
		 * e.g. `break`, `edit`, etc.?, but not `pick`, etc.
		 *
		 * TODO think if cases such as dropping a commit implicitly
		 * (removing the line instead of using the `drop` command)
		 * would have impact for us here, etc.
		 *
		 */
		makesGitRebaseExitToPause: boolean;

		// nameOrAlias: EitherRebaseEitherCommandOrAlias, //
		parseTargets?: Command["parseTargets"];
		maxUseCount?: number;
		isRestValid?: Validator;
	}
): Command => ({
	maxUseCount,
	isRestValid,
	nameButNeverAlias: nameButNeverAlias as EitherRebaseCommand, // TODO: TS
	parseTargets,
	makesGitRebaseExitToPause,
});

export const regularRebaseCommands = {
	pick: createCommand("pick", { makesGitRebaseExitToPause: false }),
	// p: standardCommand,
	reword: createCommand("reword", {
		makesGitRebaseExitToPause: false /** opens editor & then continues, w/o exiting in between */,
	}),
	// r: standardCommand,
	edit: createCommand("edit", { makesGitRebaseExitToPause: true }),
	// e: standardCommand,
	squash: createCommand("squash", {
		makesGitRebaseExitToPause: false /** opens editor & then continues, w/o exiting in between */,
	}),
	// s: standardCommand,
	fixup: createCommand("fixup", {
		makesGitRebaseExitToPause: false /** opens editor & then continues, w/o exiting in between */,

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
	exec: createCommand("exec", {
		makesGitRebaseExitToPause: false, //

		parseTargets: ({ rest }) => [rest],
	}),
	// x: standardCommand,
	break: createCommand("break", { makesGitRebaseExitToPause: true, parseTargets: () => null }),
	// b: standardCommand,
	drop: createCommand("drop", { makesGitRebaseExitToPause: false }),
	// d: standardCommand,
	label: createCommand("label", { makesGitRebaseExitToPause: false /** TODO VERIFY */ }),
	// l: standardCommand,
	reset: createCommand("reset", { makesGitRebaseExitToPause: false /** TODO VERIFY */ }),
	// t: standardCommand,
	merge: createCommand("merge", {
		makesGitRebaseExitToPause: false /** TODO VERIFY */,

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

export type RegularRebaseCommand = keyof typeof regularRebaseCommands;
export type RegularRebaseEitherCommandOrAlias = RegularRebaseCommand | RegularRebaseCommandAlias;

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

/**
 * we'll never (?) have the `makesGitRebaseExitToPause` as `true` here
 * because these commands do not end up in the regular git rebase's todo file.
 */
export const stackedRebaseCommands = {
	"branch-end": createCommand("branch-end", {
		makesGitRebaseExitToPause: false,

		maxUseCount: Infinity,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
	"branch-end-new": createCommand("branch-end-new", {
		makesGitRebaseExitToPause: false,

		maxUseCount: Infinity,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
	"branch-end-initial": createCommand("branch-end-initial", {
		makesGitRebaseExitToPause: false,

		maxUseCount: 1,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
	"branch-end-last": createCommand("branch-end-last", {
		makesGitRebaseExitToPause: false,

		maxUseCount: 1,
		isRestValid: branchValidator,
		parseTargets: ({ rest }) => [rest],
	}),
} as const;

export type StackedRebaseCommand = keyof typeof stackedRebaseCommands;

// const allowedCommandAliasesFromGitStackedRebase: { [key: string]: AllowedGitStackedRebaseCommand } = {
const stackedRebaseCommandAliases = {
	be: "branch-end",
	ben: "branch-end-new",
} as const;

export type StackedRebaseCommandAlias = keyof typeof stackedRebaseCommandAliases;
export type StackedRebaseEitherCommandOrAlias = StackedRebaseCommand | StackedRebaseCommandAlias;

/**
 * combined
 */
export type EitherRebaseCommand = RegularRebaseCommand | StackedRebaseCommand;
export type EitherRebaseCommandAlias = RegularRebaseCommandAlias | StackedRebaseCommandAlias;

export type EitherRebaseEitherCommandOrAlias = EitherRebaseCommand | EitherRebaseCommandAlias;

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

export const rebaseCommandsThatMakeRebaseExitToPause: Command[] = Object.values(allEitherRebaseCommands).filter(
	(cmd) => cmd.makesGitRebaseExitToPause
);

export const namesOfRebaseCommandsThatMakeRebaseExitToPause: EitherRebaseCommand[] = rebaseCommandsThatMakeRebaseExitToPause.map(
	(cmd) => cmd.nameButNeverAlias
);

type LineNr = {
	/**
	 * indexed from 0.
	 * counts comments/empty-lines/etc, see `nthCommand` instead
	 */
	lineNumber: number;

	/**
	 * indexed from 1.
	 * counts comments/empty-lines/etc, see `nthCommand` instead
	 */
	humanLineNumber: number;

	/**
	 * indexed from 0.
	 * counts only commands
	 * (both good and bad, though irrelevant, because will error if has bad commands)
	 */
	nthCommand: number;
};

type BadCommand = LineNr & {
	command: string;
	fullLine: string;
	reasons: string[];
};

export type GoodCommandBase = LineNr & {
	fullLine: string;
	rest: string;
	/**
	 * SHA or branch or label (all commands, except `break`, have >=1)
	 * TODO: handle >1
	 */
	targets: string[] | null;
	// commandName: EitherRebaseCommand;
};
export type GoodCommandRegular = GoodCommandBase & {
	rebaseKind: "regular";
	commandName: RegularRebaseCommand;
	commandOrAliasName: RegularRebaseEitherCommandOrAlias;
};
export type GoodCommandStacked = GoodCommandBase & {
	rebaseKind: "stacked";
	commandName: StackedRebaseCommand;
	commandOrAliasName: StackedRebaseEitherCommandOrAlias;
	commitSHAThatBranchPointsTo: string | null;
};
export type GoodCommand = GoodCommandRegular | GoodCommandStacked;

export function validate(
	linesOfEditedRebaseTodo: string[], //
	{ enforceRequirementsSpecificToStackedRebase = false } = {}
): GoodCommand[] {
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

	let previousCommitSHA: string | null = null;
	let nthCommand: number = -1;
	/**
	 * we're not processing command-by-command, we're processing line-by-line.
	 */
	for (let lineNumber = 0; lineNumber < linesOfEditedRebaseTodo.length; lineNumber++) {
		const fullLine: string = linesOfEditedRebaseTodo[lineNumber];

		if (fullLine.startsWith("#")) {
			/**
			 * ignore comments
			 */
			continue;
		}
		nthCommand++;

		const [commandOrAliasName, ..._rest] = fullLine.split(" ");
		const rest = _rest.join(" ");

		if (!commandOrAliasExists(commandOrAliasName)) {
			badCommands.push({
				command: commandOrAliasName,
				nthCommand,
				lineNumber,
				humanLineNumber: lineNumber + 1,
				fullLine,
				reasons: ["unrecognized command"],
			});

			continue;
		}

		const commandName: EitherRebaseCommand =
			commandOrAliasName in regularRebaseCommandAliases
				? regularRebaseCommandAliases[commandOrAliasName as RegularRebaseCommandAlias]
				: commandOrAliasName in stackedRebaseCommandAliases
				? stackedRebaseCommandAliases[commandOrAliasName as StackedRebaseCommandAlias]
				: (commandOrAliasName as StackedRebaseCommand);

		commandUsedAtLines[commandName].push(lineNumber);

		const reasonsIfBad: string[] = [];

		if (enforceRequirementsSpecificToStackedRebase) {
			if (nthCommand === 0) {
				if (commandName !== "branch-end-initial") {
					reasonsIfBad.push("initial command must be `branch-end-initial`");
				}
			}
			// if (index === linesOfEditedRebaseTodo.length - 1) {
			// 	if (commandName !== "branch-end-last") {
			// 		reasonsIfBad.push("last command must be `branch-end-last`");
			// 	}
			// }
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
				humanLineNumber: lineNumber + 1,
				nthCommand,
				fullLine,
				reasons: reasonsIfBad,
			});
		} else {
			goodCommands.push({
				targets,
				lineNumber,
				humanLineNumber: lineNumber + 1,
				nthCommand,
				fullLine,
				rest,
				...(commandName in regularRebaseCommands
					? {
							rebaseKind: "regular",
							commandOrAliasName: commandOrAliasName as RegularRebaseEitherCommandOrAlias,
							commandName: commandName as RegularRebaseCommand,
					  }
					: commandName in stackedRebaseCommands
					? {
							rebaseKind: "stacked",
							commandName: commandName as StackedRebaseCommand,
							commandOrAliasName: commandOrAliasName as StackedRebaseEitherCommandOrAlias,
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
	}

	if (badCommands.length) {
		throw new Termination(
			"\n" +
				joinWith("\n\n")([
					"found errors in rebase commands:",
					...badCommands.map((cmd) =>
						bullets(`  line ${cmd.humanLineNumber}: ${tick(cmd.command)}`, cmd.reasons, "     - ")
					),
					"to edit & fix, use:",
					"  git-stacked-rebase -e|--edit-todo\n",
				]).slice(1) +
				"\n\n"
		);
	}

	return goodCommands;
}
