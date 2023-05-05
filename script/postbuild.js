#!/usr/bin/env node

const fs = require("fs");
const { execSync } = require("child_process");
const { execSyncP } = require("pipestdio");

modifyLinesGSR();
modifyLinesRefFinder();

/**
 * general util for modifying lines
 */
function modifyLines(exePath, linesCb) {
	fs.chmodSync(exePath, "755");
	// execSyncP(`ls -la ${exePath}`);

	const file = fs.readFileSync(exePath, { encoding: "utf-8" });
	const lines = file.split("\n");

	const afterModificationCb = linesCb(lines);

	const newFile = lines.join("\n");
	fs.writeFileSync(exePath, newFile);

	if (afterModificationCb instanceof Function) afterModificationCb();
}

function modifyLinesGSR() {
	const exePath = "./dist/git-stacked-rebase.js";

	modifyLines(exePath, (lines) => {
		const afterUpdateShebang = updateShebang(lines, exePath);
		const afterInjectRelativeBuildDatePrinter = injectRelativeBuildDatePrinter(lines, exePath);
		const afterInjectVersionStr = injectVersionStr(lines);

		return () => {
			afterUpdateShebang();
			afterInjectRelativeBuildDatePrinter();
			afterInjectVersionStr();
		};
	});
}

function modifyLinesRefFinder() {
	const exePath = "./dist/ref-finder.js";

	modifyLines(exePath, (lines) => {
		const afterUpdateShebang = updateShebang(lines, exePath);

		return () => {
			afterUpdateShebang();
		};
	});
}

function updateShebang(lines, exePath) {
	const oldShebang = "#!/usr/bin/env ts-node-dev";
	const newShebang = "#!/usr/bin/env node";

	if (lines[0].includes(oldShebang)) {
		lines[0] = newShebang;
	} else if (!lines[0].includes(newShebang)) {
		lines.splice(0, 0, newShebang);
	}

	return () => {
		process.stdout.write(exePath + "\n");
		execSyncP(`cat ${exePath} | head -n 2`);
		process.stdout.write("\n");
	};
}

function injectRelativeBuildDatePrinter(lines, exePath) {
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

	return () => {
		process.stdout.write(exePath + "\n");
		execSyncP(`cat ${exePath} | grep " mins ago"`);
		process.stdout.write("\n");
	};
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
