const fs = require("fs");
const { execSyncP } = require("pipestdio");

const executablePath = "./dist/git-stacked-rebase.js";

fs.chmodSync(executablePath, "755");
execSyncP(`ls -la ${executablePath}`);

updateShebang(executablePath);
execSyncP(`cat ${executablePath} | head -n 2`);

function updateShebang(path) {
	const file = fs.readFileSync(path, { encoding: "utf-8" });
	const lines = file.split("\n");

	const oldShebang = "#!/usr/bin/env ts-node-dev";
	const newShebang = "#!/usr/bin/env node";

	if (lines[0].includes(oldShebang)) {
		lines[0] = newShebang;
	} else if (!lines[0].includes(newShebang)) {
		lines.splice(0, 0, newShebang);
	}

	const newFile = lines.join("\n");
	fs.writeFileSync(path, newFile);

	return;
}
