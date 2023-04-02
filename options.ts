/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";
import { bullets } from "nice-comment";

import { Termination } from "./util/error";
import { removeUndefinedProperties } from "./util/removeUndefinedProperties";

import { InternalOnlyOptions } from "./internal";
import { parseGitConfigValues } from "./config";
import { noop } from "./util/noop";

export type BaseOptionsForGitStackedRebase = {
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

	gpgSign?: boolean | undefined;
	autoSquash?: boolean | undefined;
	autoApplyIfNeeded?: boolean | undefined;

	apply: boolean;
	continue: boolean;
	push: boolean;
	forcePush: boolean;

	branchSequencer: boolean;
	branchSequencerExec: string | false;
};

/**
 * the defaults (some optional)
 */
export type OptionsForGitStackedRebase = BaseOptionsForGitStackedRebase & InternalOnlyOptions;

/**
 * the specifiable ones in the library call (all optional)
 */
export type SomeOptionsForGitStackedRebase = Partial<OptionsForGitStackedRebase>;

/**
 * the parsed ones (0 optional)
 */
export type ParsedOptionsForGitStackedRebase = Required<BaseOptionsForGitStackedRebase> & InternalOnlyOptions;

export const defaultEditor = "vi" as const;
export const defaultGitCmd = "/usr/bin/env git" as const;

export async function parseOptions(
	specifiedOptions: SomeOptionsForGitStackedRebase, //
	config: Git.Config
): Promise<ParsedOptionsForGitStackedRebase> {
	const parsedOptions: ParsedOptionsForGitStackedRebase = {
		/**
		 * order matters
		 */
		...getDefaultOptions(),
		...(await parseGitConfigValues(config)),
		...removeUndefinedProperties(specifiedOptions),
	};

	console.log({ parsedOptions });

	const reasonsWhatWhyIncompatible: string[] = [];
	if (areOptionsIncompatible(parsedOptions, reasonsWhatWhyIncompatible)) {
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

	return parsedOptions;
}

export const getDefaultOptions = (): OptionsForGitStackedRebase => ({
	gitDir: ".", //
	gitCmd: process.env.GIT_CMD ?? defaultGitCmd,
	editor: process.env.EDITOR ?? defaultEditor,
	//
	gpgSign: undefined,
	autoSquash: undefined,
	autoApplyIfNeeded: undefined,
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
});

export function areOptionsIncompatible(
	options: ParsedOptionsForGitStackedRebase, //
	reasons: string[] = []
): boolean {
	noop(options);
	/**
	 * TODO HANDLE ALL CASES
	 */

	return reasons.length > 0;
}
