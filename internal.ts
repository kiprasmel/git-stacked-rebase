/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";

import { AskQuestion } from "./util/createQuestion";

export const editor__internal = Symbol("editor__internal");
export const getGitConfig__internal = Symbol("getGitConfig__internal");

export const noEditor = {
	[editor__internal]: () => void 0,
};

export const askQuestion__internal = Symbol("askQuestion__internal");

/**
 * meant to NOT be exported to the end user of the library
 */
export type InternalOnlyOptions = {
	[editor__internal]?: EitherEditor;
	[getGitConfig__internal]?: GetGitConfig;
	[askQuestion__internal]?: AskQuestion;
};

export type EitherEditor = string | ((ctx: { filePath: string }) => void | Promise<void>);

export type GetGitConfig = (ctx: {
	GitConfig: typeof Git.Config;
	repo: Git.Repository;
}) => Promise<Git.Config> | Git.Config;
