import fs from "fs";
import path from "path";

export type CreateTmpdirOpts = {
	random?: boolean;
	bare?: number;
	infoPrefix?: string;
};

export function createTmpdir({
	random = true, //
	bare = 0,
	infoPrefix = "",
}: CreateTmpdirOpts = {}): string {
	let dir: string;

	const prefix: string =
		".tmp-" + //
		(bare ? "bare-" : "") +
		(infoPrefix.trim() ? infoPrefix + "-" : "");

	if (random) {
		dir = fs.mkdtempSync(path.join(__dirname, prefix), { encoding: "utf-8" });
		addRepoForCleanup(dir);
		return dir;
	}

	dir = path.join(__dirname, prefix);
	/**
	 * do NOT add for cleanup,
	 * because it's not random
	 */

	if (fs.existsSync(dir)) {
		fs.rmdirSync(dir, { recursive: true, ...{ force: true } });
	}
	fs.mkdirSync(dir);

	return dir;
}

export const foldersToDeletePath: string = path.join(__dirname, "folders-to-delete");

export function addRepoForCleanup(dir: string): void {
	if (!fs.existsSync(foldersToDeletePath)) {
		fs.writeFileSync(foldersToDeletePath, "");
	}

	fs.appendFileSync(foldersToDeletePath, dir + "\n", { encoding: "utf-8" });
}

export function cleanupTmpRepos(): void {
	const deletables: string[] = fs.readFileSync(foldersToDeletePath, { encoding: "utf-8" }).split("\n");

	for (const d of deletables) {
		if (fs.existsSync(d)) {
			fs.rmdirSync(d, { recursive: true, ...{ force: true } });
		}
	}
}
