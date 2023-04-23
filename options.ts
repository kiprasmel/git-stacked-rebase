/* eslint-disable @typescript-eslint/camelcase */

import fs from "fs";
import path from "path";

import Git from "nodegit";
import { bullets } from "nice-comment";

import { Termination } from "./util/error";
import { removeUndefinedProperties } from "./util/removeUndefinedProperties";

import { InternalOnlyOptions } from "./internal";
import { ConfigValues, defaultConfigValues, resolveGitConfigValues } from "./config";
import { filenames } from "./filenames";
import { noop } from "./util/noop";

/**
 * first, the required options:
 * without them, GSR cannot function properly.
 */
export type _BaseOptionsForGitStackedRebase_Required = {
	initialBranch: string;

	gitDir: string;

	/**
	 * editor name, or a function that opens the file inside some editor.
	 */
	editor: string;

	/**
	 * for executing raw git commands
	 * that aren't natively supported by `nodegit` (libgit2)
	 */
	gitCmd: string;
};

export type _BaseOptionsForGitStackedRebase_Optional = Partial<{
	gpgSign: boolean;
	autoSquash: boolean;
	autoApplyIfNeeded: boolean;
	autoOpenPRUrlsInBrowser: ConfigValues["autoOpenPRUrlsInBrowser"];
	ignoredBranches: ConfigValues["ignoredBranches"];

	apply: boolean;
	continue: boolean;
	push: boolean;
	forcePush: boolean;

	branchSequencer: boolean;
	branchSequencerExec: string | false;

	pullRequest: boolean;
}>;

export type ResolvedGitStackedRebaseOptions = Required<_BaseOptionsForGitStackedRebase_Optional> &
	_BaseOptionsForGitStackedRebase_Required &
	InternalOnlyOptions;

/**
 * the specifiable ones in the library call (all optional)
 */
export type SpecifiableGitStackedRebaseOptions = Partial<
	Omit<
		ResolvedGitStackedRebaseOptions,
		/** some options can be specified thru config, but not as CLI arg: */
		"ignoredBranches"
	>
>;

export const defaultEditor = "vi" as const;
export const defaultGitCmd = "/usr/bin/env git" as const;

export type ResolveOptionsCtx = {
	config: Git.Config;
	dotGitDirPath: string;
};

export async function resolveOptions(
	specifiedOptions: SpecifiableGitStackedRebaseOptions, //
	{
		config, //
		dotGitDirPath,
	}: ResolveOptionsCtx
): Promise<ResolvedGitStackedRebaseOptions> {
	const resolvedOptions: ResolvedGitStackedRebaseOptions = {
		/**
		 * order matters for what takes priority.
		 */
		...getDefaultResolvedOptions(),
		...(await resolveGitConfigValues(config)),
		...removeUndefinedProperties(specifiedOptions),

		/**
		 * the `initialBranch` arg is taken from `specifiedOptions`, instead of `resolvedOptions`,
		 * because we do want to throw the error if the user didn't specify & does not have cached.
		 */
		initialBranch: resolveInitialBranchNameFromProvidedOrCache({
			initialBranch: specifiedOptions.initialBranch, //
			dotGitDirPath,
		}),
	};

	const reasonsWhatWhyIncompatible: string[] = [];
	if (areOptionsIncompatible(resolvedOptions, reasonsWhatWhyIncompatible)) {
		const msg =
			"\n" +
			bullets(
				"error - incompatible options:", //
				reasonsWhatWhyIncompatible,
				"  "
			) +
			"\n\n";
		throw new Termination(msg);
	}

	return resolvedOptions;
}

export const getDefaultResolvedOptions = (): ResolvedGitStackedRebaseOptions => ({
	initialBranch: "origin/master",
	//
	gitDir: ".", //
	gitCmd: process.env.GIT_CMD ?? defaultGitCmd,
	editor: process.env.EDITOR ?? defaultEditor,
	//
	gpgSign: false,
	autoSquash: false,
	autoApplyIfNeeded: false,
	autoOpenPRUrlsInBrowser: defaultConfigValues.autoOpenPRUrlsInBrowser,
	ignoredBranches: [],
	//
	apply: false,
	//
	continue: false,
	//
	push: false,
	forcePush: false,
	//
	branchSequencer: false,
	branchSequencerExec: false,
	//
	pullRequest: false,
});

export function areOptionsIncompatible(
	options: ResolvedGitStackedRebaseOptions, //
	reasons: string[] = []
): boolean {
	noop(options);
	/**
	 * TODO HANDLE ALL CASES
	 */

	return reasons.length > 0;
}

export type ResolveInitialBranchNameFromProvidedOrCacheCtx = {
	initialBranch?: SpecifiableGitStackedRebaseOptions["initialBranch"];
	dotGitDirPath: string;
};

export function resolveInitialBranchNameFromProvidedOrCache({
	initialBranch, //
	dotGitDirPath,
}: ResolveInitialBranchNameFromProvidedOrCacheCtx): string {
	const pathToStackedRebaseDirInsideDotGit: string = path.join(dotGitDirPath, "stacked-rebase");
	const initialBranchCachePath: string = path.join(pathToStackedRebaseDirInsideDotGit, filenames.initialBranch);

	fs.mkdirSync(pathToStackedRebaseDirInsideDotGit, { recursive: true });

	const hasCached = () => fs.existsSync(initialBranchCachePath);
	const setCache = (initialBranch: string) => fs.writeFileSync(initialBranchCachePath, initialBranch);
	const getCache = (): string => fs.readFileSync(initialBranchCachePath).toString();

	if (initialBranch) {
		setCache(initialBranch);
		return initialBranch;
	}

	if (hasCached()) {
		return getCache();
	} else {
		/**
		 * TODO: try from config if default initial branch is specified,
		 * if yes - check if is here, if yes - ask user if start from there.
		 * if no - throw
		 */
		const msg = `\ndefault argument of the initial branch is required.\n\n`;
		throw new Termination(msg);
	}
}

export async function parseInitialBranch(repo: Git.Repository, nameOfInitialBranch: string): Promise<Git.Reference> {
	const initialBranch: Git.Reference | void = await Git.Branch.lookup(repo, nameOfInitialBranch, Git.Branch.BRANCH.ALL);

	if (!initialBranch) {
		throw new Termination("initialBranch lookup failed");
	}

	return initialBranch;
}
