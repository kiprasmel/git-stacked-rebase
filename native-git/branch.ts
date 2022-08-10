import { execSync } from "child_process";

import Git from "nodegit";

import { assertNever } from "../util/assertNever";

export type BranchFilter = "local" | "remote" | "all";

export const nativeGetBranchNames = (repoPath: string) => (
	filter: BranchFilter,
	/* eslint-disable indent */
	filterFlag = filter === "local"
		? "--list"
		: filter === "remote"
		? "--remotes"
		: filter === "all"
		? "--all"
		: assertNever(filter),
	/* eslint-enable indent */
	cmd = `git branch ${filterFlag} --format "%(refname:short)"`,
	ret = execSync(cmd, {
		cwd: repoPath, //
		encoding: "utf-8",
	}).split("\n")
): string[] => ret;

export const getBranches = (
	repo: Git.Repository //
) => async (
	filter: BranchFilter, //
	branchNames: string[] = nativeGetBranchNames(repo.workdir())(filter),
	lookupPromises = branchNames.map((b) => Git.Branch.lookup(repo, b, Git.Branch.BRANCH.ALL)),
	ret = Promise.all(lookupPromises)
): Promise<Git.Reference[]> => ret;

export const nativePush = (
	repoPath: string //
) => (
	branchNames: string[] = nativeGetBranchNames(repoPath)("local"), //
	{ remote = "origin", setupRemoteTracking = true } = {},
	remoteTrackingFlag = setupRemoteTracking ? "-u" : ""
): string[] => (
	branchNames.forEach((branch) => {
		const cmd = `git push ${remoteTrackingFlag} ${remote} ${branch}`;
		execSync(cmd, {
			cwd: repoPath,
			encoding: "utf-8",
		});
	}),
	branchNames
);
