const assert = require("assert");
const fs = require("fs");

const readSplit = (path) =>
	fs //
		.readFileSync(path, { encoding: "utf-8" })
		.split("\n")
		.map((line) => line.trim());

/**
 * TODO: also includes tags etc., gotta be careful.
 */
const commits = readSplit("commits");

const branches = readSplit("branches");

// console.log({ commits, branches });
fs.writeFileSync("commits.txt", commits.join("\n"));
fs.writeFileSync("branches.txt", branches.join("\n"));

// console.log({ commits });

const commitsWithBranches = [...commits];
for (let i = 0; i < commits.length; i++) {
	const b = branches[i];

	if (b) {
		commitsWithBranches.splice(i, 0, b);
	}
}
fs.writeFileSync("commitsWithBranches.txt", commitsWithBranches.join("\n"));

let branchesParsed = branches.map(
	(b) => (
		console.log({ b }),
		b //
			.replace("HEAD -> ", "")
			.slice(1, -1) // remove ()
			.split(", ")
			.filter((bb) => !/tag: \w/.test(bb))
	)
);
console.log({ branchesParsed });
fs.writeFileSync("branchesParsed.txt", branchesParsed.join("\n"));

branchesParsed = branchesParsed.map((bs) => {
	console.log({ bs });
	const removable = bs
		.map((b) => {
			const regexOfBranchOnRemote = new RegExp(`/${b}$`);
			const sameButOnRemote = bs.filter((B) => regexOfBranchOnRemote.test(B));
			return sameButOnRemote;

			// if (sameButOnRemote.length) {
			// 	bs = bs.filter((B) => !regexOfBranchOnRemote.test(B));
			// }
		})
		.flat();

	const newBs = bs.filter((b) => !removable.includes(b));

	if (newBs.length > 1) {
		console.error({ bs, removable, newBs });
		throw new Error(`more than 1 branch per commit (excluding if branch on remote).`);
	}
	if (bs.length <= 0) {
		throw new Error("wut");
	}
});

const commitsWithBranchesParsed = [...commits];
for (let i = 0; i < commitsWithBranchesParsed.length; i++) {
	const bs = branchesParsed[i];
	assert(bs.length === 1);
	const b = bs[0];

	if (b) {
		commitsWithBranchesParsed.splice(i, 0, b);
	}
}
fs.writeFileSync("commitsWithBranchesParsed.txt", commitsWithBranchesParsed.join("\n"));
