import { execSync } from "child_process";

import Git from "nodegit";
import { pipestdio } from "pipestdio";

/**
 * always use this when doing git commands,
 * because if user is in a different directory
 * & is running git-stacked-rebase w/ a different path,
 * then the git commands, without the repo.workdir() as cwd,
 * would act on the current directory that the user is in (their cwd),
 * as opposted to the actual target repo (would be very bad!)
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createExecSyncInRepo = (repo: Git.Repository) => (
	command: string,
	extraOptions: Parameters<typeof execSync>[1] = {}
) =>
	execSync(command, {
		...pipestdio(),
		...extraOptions,
		/**
		 * the `cwd` must be the last param here
		 * to avoid accidentally overwriting it.
		 * TODO TS - enforce
		 */
		cwd: repo.workdir(),
	});
