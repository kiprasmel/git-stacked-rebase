/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";

export const editor__internal = Symbol("editor__internal");
export const getGitConfig__internal = Symbol("getGitConfig__internal");

/**
 * meant to NOT be exported to the end user of the library
 */
export type InternalOnlyOptions = {
	[editor__internal]?: EitherEditor;
	[getGitConfig__internal]?: GetGitConfig;
};

export type EitherEditor = string | ((ctx: { filePath: string }) => void | Promise<void>);

export type GetGitConfig = (ctx: {
	GitConfig: typeof Git.Config;
	repo: Git.Repository;
}) => Promise<Git.Config> | Git.Config;
