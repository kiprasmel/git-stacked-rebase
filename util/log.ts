import fs from "fs";
import path from "path";
import util from "util";

import { tmpdirConst } from "./tmpdir";

export const GSR_LOGDIR: string = tmpdirConst("git-stacked-rebase", "logs");

const GSR_LAUNCH_TIMESTAMP: string = new Date().toISOString();
const GSR_CURRENT_LAUNCH_LOGFILE = path.join(GSR_LOGDIR, GSR_LAUNCH_TIMESTAMP + ".log");

export function log(...msgs: any[]): void {
	if (process.env.GSR_DEBUG || process.env.CI) {
		console.log(...msgs);
	}

	const out = util.format(...msgs) + "\n";
	fs.appendFileSync(GSR_CURRENT_LAUNCH_LOGFILE, out, { encoding: "utf-8" });
}

/**
 * sometimes want to always print more informative messages,
 * while also storing into logfile.
 */
export function logAlways(...msgs: any[]): void {
	console.log(...msgs);

	const out = util.format(...msgs) + "\n";
	fs.appendFileSync(GSR_CURRENT_LAUNCH_LOGFILE, out, { encoding: "utf-8" });
}
