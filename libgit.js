#!/usr/bin/env node

const { execSync } = require("child_process");

const yarnGlobalDir = execSync("yarn global dir", { encoding: "utf-8" }).trim();

const Git = require(`${yarnGlobalDir}/node_modules/nodegit`);

foo();

async function foo() {
	const repo = await Git.Repository.open(".");

	const refs = await repo.getReferences();

	const proms = await Promise.all(
		(await Promise.all(refs.map(async (r) => [r, await r.peel(Git.Object.TYPE.ANY)]))).map(
			async ([r, rr]) => r + " " + (await rr.id())
		)
	);

	console.log({ proms });

	// console.log({refs: await Promise.all(refs.map(async r => r.name() + (await (await r.peel(Git.Object.TYPE.ANY))).shortId()))})
}
