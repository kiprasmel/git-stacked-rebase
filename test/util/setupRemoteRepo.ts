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

	/**
	 * setup stacked branches
	 */
	const localRepoAlice = await setupRepo({
		initRepoBase: async () => baseRepoInLocalAlice,
	});

	// TODO
	const originAlice: Git.Remote = await localRepoAlice.repo.getRemote("origin");
	console.log({ originAlice });

	// TODO proper type - returns promise
	const rsp = originAlice.getRefspec(0);
	console.log({ rsp: rsp.string() });

	const refspecs = localRepoAlice.branches.map((b) => "+" + b.name() + ":refs/remotes/origin/" + b.shorthand());
	console.log({ refspecs });

	// await originAlice.upload("+refs/heads/*:refs/remotes/origin/*");
	// await originAlice.push(["+refs/heads/*:refs/remotes/origin/*"]);
	await originAlice.push(refspecs);

	const originBob: Git.Remote = await baseRepoInLocalBob.repo.getRemote("origin");
	const refSpecsInBobPush = await originBob.getPushRefspecs();
	const refSpecsInBobFetch = await originBob.getFetchRefspecs();
	console.log({ refSpecsInBobFetch, refSpecsInBobPush });

	const branchesInLocalBobBefore: Git.Reference[] = await Git.Reference.list(baseRepoInLocalBob.repo);
	console.log({ branchesInLocalBobBefore: branchesInLocalBobBefore.map((ref) => ref.name()) });

	await Git.Remote.addFetch(baseRepoInLocalBob.repo, "origin", "+refs/remotes/origin/*:refs/heads/*");
	// await Git.Remote.addFetch(baseRepoInLocalBob.repo, "origin", "refs/heads/*:+refs/remotes/origin/*");
	await baseRepoInLocalBob.repo.fetch("origin");

	const branchesInLocalBobAfter: Git.Reference[] = await Git.Reference.list(baseRepoInLocalBob.repo);
	// const it = await (Git.Branch as any).list(baseRepoInLocalBob.repo, Git.Branch.BRANCH.ALL);
	console.log({
		branchesInLocalBobAfter,
		// branchesInLocalBobAfter: branchesInLocalBobAfter.map((ref) =>
		// 	!ref.isBranch() ? "<not-a-branch>" : ref.isRemote() ? "<remote>" : ref.name()
		// ),
	});

	// refSpecsInBobPush = await originBob.getPushRefspecs();
	// refSpecsInBobFetch = await originBob.getFetchRefspecs();
	// console.log({ refSpecsInBobFetch, refSpecsInBobPush });

	return {
		baseRepoInRemote,
		localRepoAlice,
		baseRepoInLocalBob,
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
