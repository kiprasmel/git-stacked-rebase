#!/usr/bin/env ts-node-dev

import assert from "assert";

import { NonPositional, NonPositionalWithValue, eatNonPositionals, eatNonPositionalsWithValues } from "./argparse";

export function argparse_TC() {
	eatNonPositionals_singleArg();
	eatNonPositionals_multipleArgs();

	eatNonPositionalsWithValues_singleArg();
	eatNonPositionalsWithValues_multipleArgs();
}

function eatNonPositionals_singleArg() {
	const argv = ["origin/master", "--autosquash", "foo", "bar"];
	const targetArgs = ["--autosquash", "--no-autosquash"];
	const expected: NonPositional[] = [{ argName: "--autosquash", origIdx: 1 }];
	const expectedLeftoverArgv = ["origin/master", "foo", "bar"];

	const parsed = eatNonPositionals(targetArgs, argv);

	assert.deepStrictEqual(parsed, expected);
	assert.deepStrictEqual(argv, expectedLeftoverArgv);
}
function eatNonPositionals_multipleArgs() {
	const argv = ["origin/master", "--autosquash", "foo", "bar", "--no-autosquash", "baz"];
	const targetArgs = ["--autosquash", "--no-autosquash"];
	const expected: NonPositional[] = [
		{ argName: "--autosquash", origIdx: 1 },
		{ argName: "--no-autosquash", origIdx: 4 },
	];
	const expectedLeftoverArgv = ["origin/master", "foo", "bar", "baz"];

	const parsed = eatNonPositionals(targetArgs, argv);

	assert.deepStrictEqual(parsed, expected);
	assert.deepStrictEqual(argv, expectedLeftoverArgv);
}

function eatNonPositionalsWithValues_singleArg() {
	const argv = ["origin/master", "--git-dir", "~/.dotfiles", "foo", "bar"];
	const targetArgs = ["--git-dir", "--gd"];
	const expected: NonPositionalWithValue[] = [{ argName: "--git-dir", origIdx: 1, argVal: "~/.dotfiles" }];
	const expectedLeftoverArgv = ["origin/master", "foo", "bar"];

	const parsed = eatNonPositionalsWithValues(targetArgs, argv);

	assert.deepStrictEqual(parsed, expected);
	assert.deepStrictEqual(argv, expectedLeftoverArgv);
}
function eatNonPositionalsWithValues_multipleArgs() {
	const argv = ["origin/master", "--git-dir", "~/.dotfiles", "foo", "bar", "--misc", "miscVal", "unrelatedVal"];
	const targetArgs = ["--git-dir", "--gd", "--misc"];
	const expected: NonPositionalWithValue[] = [
		{ argName: "--git-dir", origIdx: 1, argVal: "~/.dotfiles" },
		{ argName: "--misc", origIdx: 5, argVal: "miscVal" },
	];
	const expectedLeftoverArgv = ["origin/master", "foo", "bar", "unrelatedVal"];

	const parsed = eatNonPositionalsWithValues(targetArgs, argv);

	assert.deepStrictEqual(parsed, expected);
	assert.deepStrictEqual(argv, expectedLeftoverArgv);
}

if (!module.parent) {
	argparse_TC();
}
