#!/usr/bin/env node

const fs = require("fs");
const { execSync } = require("child_process");
const { execSyncP } = require("pipestdio");

const executablePath = "./dist/git-stacked-rebase.js";

fs.chmodSync(executablePath, "755");
execSyncP(`ls -la ${executablePath}`);

modifyLines(executablePath);

function modifyLines(path) {
	const file = fs.readFileSync(path, { encoding: "utf-8" });
	const lines = file.split("\n");

	const afterUpdateShebang = updateShebang(lines);
	const afterInjectRelativeBuildDatePrinter = injectRelativeBuildDatePrinter(lines);
	const afterInjectVersionStr = injectVersionStr(lines);

	const newFile = lines.join("\n");
	fs.writeFileSync(path, newFile);

	afterUpdateShebang();
	afterInjectRelativeBuildDatePrinter();
	afterInjectVersionStr();
}

function updateShebang(lines) {
	const oldShebang = "#!/usr/bin/env ts-node-dev";
	const newShebang = "#!/usr/bin/env node";

	if (lines[0].includes(oldShebang)) {
		lines[0] = newShebang;
	} else if (!lines[0].includes(newShebang)) {
		lines.splice(0, 0, newShebang);
	}

	return () => execSyncP(`cat ${executablePath} | head -n 2`);
}

function injectRelativeBuildDatePrinter(lines) {
	const BUILD_DATE_REPLACEMENT_STR = "__BUILD_DATE_REPLACEMENT_STR__";
	const targetLineIdx = lines.findIndex((line) => line.includes(BUILD_DATE_REPLACEMENT_STR));

	const buildDate = new Date().getTime();
	const printRelativeDate =
		"(" + //
		"built " +
		"${" +
		`Math.round((new Date() - ${buildDate}) / 1000 / 60)` +
		"}" +
		" mins ago" +
		")";

	lines[targetLineIdx] = lines[targetLineIdx].replace(BUILD_DATE_REPLACEMENT_STR, printRelativeDate);

	return () => execSyncP(`cat ${executablePath} | grep " mins ago"`);
}

function injectVersionStr(lines) {
	const NEEDLE = "__VERSION_REPLACEMENT_STR__";
	const targetLines = lines.map((line, idx) => [line, idx]).filter(([line]) => line.includes(NEEDLE));

	if (!targetLines.length) {
		throw new Error("0 target lines found.");
	}

	const commitSha = execSync("git rev-parse @").toString().trim();
	const hasUntrackedChanges = execSync("git status -s", { encoding: "utf-8" }).toString().length > 0;

	const REPLACEMENT = commitSha + (hasUntrackedChanges ? "-dirty" : "");

	for (const [_line, idx] of targetLines) {
		lines[idx] = lines[idx].replace(NEEDLE, REPLACEMENT);
	}

	// return () => execSyncP(`cat ${executablePath} | grep -v ${NEEDLE}`);
	return () => void 0;
}
