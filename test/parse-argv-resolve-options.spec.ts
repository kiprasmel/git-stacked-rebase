#!/usr/bin/env ts-node-dev

import fs from "fs";
import path from "path";
import os from "os";
import assert from "assert";

import Git from "nodegit";

import {
	ResolvedGitStackedRebaseOptions,
	getDefaultResolvedOptions,
	parseArgs,
	parseArgv,
	resolveOptions,
} from "../git-stacked-rebase";

import { rmdirSyncR } from "../util/fs";

export async function parseArgvResolveOptions_TC() {
	for (const testData of simpleTests) {
		console.log({ testData });
		await runSimpleTest(...testData);
	}
}

type SimpleTestInput = [
	specifiedOptions: Parameters<typeof parseArgv | typeof parseArgs>[0],
	expectedOptions: Partial<ResolvedGitStackedRebaseOptions>
];

/**
 * TODO:
 * - [ ] custom setup, i.e. a function w/ context that's run before parsing the options, to e.g. modify the config
 * - [ ] a way to handle Termination's, throw's in general
 * - [ ] multiple rebases one after another, to e.g. test that initialBranch is not needed for 2nd invocation
 *
 * prolly better to have separate file for more advanced tests, & keep this one simple
 */
const simpleTests: SimpleTestInput[] = [
	/** ensure defaults produce the same defaults: */
	[["origin/master"], {}],
	["origin/master", {}],

	["custom-branch", { initialBranch: "custom-branch" }],

	["origin/master -a", { apply: true }],
	["origin/master --apply", { apply: true }],

	["origin/master -p -f", { push: true, forcePush: true }],
	["origin/master --push --force", { push: true, forcePush: true }],

	["origin/master --continue", { continue: true }],

	["origin/master", { autoSquash: false }],
	["origin/master --autosquash", { autoSquash: true }],
	["origin/master --autosquash --no-autosquash", { autoSquash: false }],
	["origin/master --autosquash --no-autosquash --autosquash", { autoSquash: true }],
	["origin/master --autosquash --no-autosquash --autosquash --no-autosquash", { autoSquash: false }],

	["origin/master -s -x ls", { branchSequencer: true, branchSequencerExec: "ls" }],
	["origin/master --bs -x ls", { branchSequencer: true, branchSequencerExec: "ls" }],
	[
		/** TODO E2E: test if paths to custom scripts work & in general if works as expected */
		"origin/master --branch-sequencer --exec ./custom-script.sh",
		{ branchSequencer: true, branchSequencerExec: "./custom-script.sh" },
	],
];

async function runSimpleTest(specifiedOptions: SimpleTestInput[0], expectedOptions: SimpleTestInput[1]) {
	const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "argv-options-test"));
	const tmpfile = path.join(tmpdir, ".git-config");
	const tmpGitConfig: Git.Config = await Git.Config.openOndisk(tmpfile);

	const parsedArgv = typeof specifiedOptions === "string" ? parseArgs(specifiedOptions) : parseArgv(specifiedOptions);
	console.log({ parsedArgv });

	const resolvedOptions: ResolvedGitStackedRebaseOptions = await resolveOptions(parsedArgv, {
		config: tmpGitConfig, //
		dotGitDirPath: path.join(tmpdir, ".git"),
	});

	const fullExpectedOptions: ResolvedGitStackedRebaseOptions = { ...getDefaultResolvedOptions(), ...expectedOptions };
	assert.deepStrictEqual(resolvedOptions, fullExpectedOptions);

	// cleanup
	rmdirSyncR(tmpdir);
}

if (!module.parent) {
	parseArgvResolveOptions_TC();
}
