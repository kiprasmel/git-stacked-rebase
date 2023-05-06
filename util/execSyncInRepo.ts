import { execSync } from "child_process";

import { pipestdio } from "pipestdio";

import { log } from "./log";

export type CreateExecSyncInRepoConfig = {
	logCmd?: boolean;
};

/**
 * always use this when doing git commands,
 * because if user is in a different directory
 * & is running git-stacked-rebase w/ a different path,
 * then the git commands, without the repo.workdir() as cwd,
 * would act on the current directory that the user is in (their cwd),
 * as opposted to the actual target repo (would be very bad!)
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createExecSyncInRepo = (repoPath: string, { logCmd = !!process.env.GSR_DEBUG }: CreateExecSyncInRepoConfig = {}) => (
	command: string,
	extraOptions: Parameters<typeof execSync>[1] = {}
) => (
	logCmd && log(`execSync: ${command}`),
	execSync(command, {
		...pipestdio(),
		...extraOptions,
		/**
		 * the `cwd` must be the last param here
		 * to avoid accidentally overwriting it.
		 * TODO TS - enforce
		 */
		cwd: repoPath,
	})
);
