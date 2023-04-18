import { Termination } from "./util/error";

export const createGithubURLForStackedPR = ({
	repoOwner, //
	repo,
	baseBranch,
	newBranch,
}: {
	repoOwner: string;
	repo: string;
	baseBranch: string;
	newBranch: string;
}): string => `https://github.com/${repoOwner}/${repo}/compare/${baseBranch}...${newBranch}`;

/**
 * TODO: support all formats properly, see:
 * - https://stackoverflow.com/a/31801532/9285308
 *   - https://github.com/git/git/blob/master/urlmatch.c
 *   - https://github.com/git/git/blob/master/urlmatch.h
 *   - https://github.com/git/git/blob/master/t/t0110-urlmatch-normalization.sh
 */
export function parseGithubRemoteUrl(remoteUrl: string) {
	if (remoteUrl.startsWith("git@")) {
		// git@http://github.com:kiprasmel/git-stacked-rebase.git

		const hasHttp = remoteUrl.includes("http://") || remoteUrl.includes("https://");
		if (hasHttp) {
			remoteUrl = remoteUrl.replace(/https?:\/\//, "");
		}
		// git@github.com:kiprasmel/git-stacked-rebase.git

		// remove base url
		remoteUrl = remoteUrl.split(":").slice(1).join(":");
		// kiprasmel/git-stacked-rebase.git

		if (remoteUrl.endsWith(".git")) {
			remoteUrl = remoteUrl.slice(0, -4);
		}
		// kiprasmel/git-stacked-rebase

		const [repoOwner, repo] = remoteUrl.split("/");
		return { repoOwner, repo };
	} else if (remoteUrl.startsWith("http")) {
		// https://github.com/kiprasmel/git-stacked-rebase.git

		const hasHttp = remoteUrl.includes("http://") || remoteUrl.includes("https://");
		if (hasHttp) {
			remoteUrl = remoteUrl.replace(/https?:\/\//, "");
		}
		// github.com/kiprasmel/git-stacked-rebase.git

		// remove base url
		remoteUrl = remoteUrl.split("/").slice(1).join("/");
		// kiprasmel/git-stacked-rebase.git

		if (remoteUrl.endsWith(".git")) {
			remoteUrl = remoteUrl.slice(0, -4);
		}
		// kiprasmel/git-stacked-rebase

		const [repoOwner, repo] = remoteUrl.split("/");
		return { repoOwner, repo };
	} else {
		const msg = `\nUnrecognized URL format of remote: got "${remoteUrl}". Probably just un-implemented yet..\n\n`;
		throw new Termination(msg);
	}
}
