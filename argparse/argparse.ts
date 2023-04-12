import assert from "assert";

export type Maybe<T> = T | undefined;

export type Argv = string[];
export type MaybeArg = Maybe<string>;

/**
 * parses the argv.
 * mutates the `argv` array.
 */
export function createArgParse(argv: Argv) {
	const getArgv = (): Argv => argv;
	const peakNextArg = (): MaybeArg => argv[0];
	const eatNextArg = (): MaybeArg => argv.shift();
	const hasMoreArgs = (): boolean => argv.length > 0;

	return {
		getArgv,
		peakNextArg,
		eatNextArg,
		hasMoreArgs,
		eatNonPositionals: (argNames: string[]) => eatNonPositionals(argNames, argv),
		eatNonPositionalsWithValues: (argNames: string[]) => eatNonPositionalsWithValues(argNames, argv),
	};
}

export type NonPositional = {
	origIdx: number;
	argName: string;
};

export type NonPositionalWithValue = NonPositional & {
	argVal: string;
};

export function eatNonPositionals(
	argNames: string[],
	argv: Argv,
	{
		howManyItemsToTakeWhenArgMatches = 1, //
	} = {}
): NonPositional[] {
	const argMatches = (idx: number) => argNames.includes(argv[idx]);
	let matchedArgIndexes: NonPositional["origIdx"][] = [];

	for (let i = 0; i < argv.length; i++) {
		if (argMatches(i)) {
			for (let j = 0; j < howManyItemsToTakeWhenArgMatches; j++) {
				matchedArgIndexes.push(i + j);
			}
		}
	}

	if (!matchedArgIndexes.length) {
		return [];
	}

	const nonPositionalsWithValues: NonPositional[] = [];
	for (const idx of matchedArgIndexes) {
		nonPositionalsWithValues.push({
			origIdx: idx,
			argName: argv[idx],
		});
	}

	const shouldRemoveArg = (idx: number) => matchedArgIndexes.includes(idx);
	const argvIndexesToRemove: number[] = [];

	for (let i = 0; i < argv.length; i++) {
		if (shouldRemoveArg(i)) {
			argvIndexesToRemove.push(i);
		}
	}

	removeArrayValuesAtIndices(argv, argvIndexesToRemove);

	return nonPositionalsWithValues;
}

export function eatNonPositionalsWithValues(argNames: string[], argv: Argv): NonPositionalWithValue[] {
	const argsWithTheirValueAsNextItem: NonPositional[] = eatNonPositionals(argNames, argv, {
		howManyItemsToTakeWhenArgMatches: 2,
	});

	assert.deepStrictEqual(argsWithTheirValueAsNextItem.length % 2, 0, `expected all arguments to have a value.`);

	const properArgsWithValues: NonPositionalWithValue[] = [];
	for (let i = 0; i < argsWithTheirValueAsNextItem.length; i += 2) {
		const arg = argsWithTheirValueAsNextItem[i];
		const val = argsWithTheirValueAsNextItem[i + 1];

		properArgsWithValues.push({
			origIdx: arg.origIdx,
			argName: arg.argName,
			argVal: val.argName,
		});
	}

	return properArgsWithValues;
}

/**
 * internal utils
 */

export function removeArrayValuesAtIndices<T>(arrayRef: T[], indexesToRemove: number[]): void {
	/**
	 * go in reverse.
	 *
	 * because if went from 0 to length,
	 * removing an item from the array would adjust all other indices,
	 * which creates a mess & needs extra handling.
	 */
	const indexesBigToSmall = [...indexesToRemove].sort((A, B) => B - A);

	for (const idxToRemove of indexesBigToSmall) {
		arrayRef.splice(idxToRemove, 1);
	}

	return;
}

/**
 * common utilities for dealing w/ parsed values:
 */

export function maybe<T, S, N>(
	x: T, //
	Some: (x: T) => S,
	None: (x?: never) => N
) {
	if (x instanceof Array) {
		return x.length ? Some(x) : None();
	}

	return x !== undefined ? Some(x) : None();
}

export const last = <T>(xs: T[]): T => xs[xs.length - 1];
