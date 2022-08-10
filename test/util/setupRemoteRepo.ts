#!/usr/bin/env ts-node-dev

import Git from "nodegit";

import { setupRepo, setupRepoBase } from "./setupRepo";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRemoteRepo() {
	const {
		baseRepoInRemote, //
		baseRepoInLocalAlice,
		baseRepoInLocalBob,
	} = await setupRemoteRepoBase();

	const RemoteBareServer = await Promise.resolve(baseRepoInRemote);

	const RemoteAlice = await Promise.resolve(baseRepoInLocalAlice).then((owner) =>
		/**
		 * setup stacked branches
		 */
		setupRepo({
			initRepoBase: () => baseRepoInLocalAlice,
		}).then((repoMeta) => ({
			...owner,
			repoMeta,
		}))
	);

	const LocalBob = await Promise.resolve(baseRepoInLocalBob)
		.then((owner) => (Git.Remote.addFetch(owner.repo, "origin", "+refs/remotes/origin/*:refs/heads/*"), owner))
		.then((owner) => ({
			...owner,
			/**
			 * TODO NATIVE?
			 */
			async fetch(remote = "origin"): Promise<void> {
				return await owner.repo.fetch(remote);
			},
		}));

	console.log({ RemoteBareServer, RemoteAlice, LocalBob });

	RemoteAlice.push();
	await LocalBob.fetch();

	/**
	 * need to checkout the initial branch first,
	 * so that repo is in valid state,
	 * instead of at 0-commit master.
	 */
	LocalBob.execSyncInRepo(`git checkout ${RemoteAlice.repoMeta.initialBranch}`);

	return {
		RemoteBareServer,
		RemoteAlice,
		LocalBob,
	};
}

/**
 * https://git-scm.com/book/en/v2/Git-on-the-Server-The-Protocols
 * https://git-scm.com/book/en/v2/Git-on-the-Server-Getting-Git-on-a-Server
 *
 *
 * idea is to setup a remote repo,
 * as a bare repository.
 *
 * then clone it in some location,
 * imitating an external user who's done something,
 * and then having a fresh, not-yet-fetched,
 * not-yet-all-branches-checked-out, etc. repo.
 *
 * TODO maybe rename to "setupRepoWithRemoteChanges"
 *
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function setupRemoteRepoBase() {
	const baseRepoInRemote = await setupRepoBase({
		bare: 1, //
		infoPrefix: "Remote",
	});

	// const someoneElse = {}; // TODO w/ sig, etc

	const remotePath: string = "file://" + baseRepoInRemote.dir;

	const baseRepoInLocalAlice = await setupRepoBase({
		infoPrefix: "Alice",
		initRepo: ({ dir }) => Git.Clone.clone(remotePath, dir, {}),
	});

	const baseRepoInLocalBob = await setupRepoBase({
		infoPrefix: "Bob",
		initRepo: ({ dir }) => Git.Clone.clone(remotePath, dir, {}),
	});

	return {
		baseRepoInRemote,
		baseRepoInLocalAlice,
		baseRepoInLocalBob,
	};
}

if (!module.parent) {
	setupRemoteRepo();
}
