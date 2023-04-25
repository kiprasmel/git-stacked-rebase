import fs from "fs";
import path from "path";
import os from "os";

export const tmpdirRand = (...prefixes: string[]): string => fs.mkdtempSync(path.join(os.tmpdir(), ...prefixes));

export const tmpdirConst = (...prefixes: string[]): string => {
	const dirpath = path.join(os.tmpdir(), ...prefixes);
	fs.mkdirSync(dirpath, { recursive: true, ...{ force: true } });

	return dirpath;
};
