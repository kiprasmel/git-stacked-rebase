import { exec } from "child_process";

export async function nativeConfigGet(key: string): Promise<string> {
	return new Promise((res, rej) =>
		exec(`git config --get ${key}`, { encoding: "utf-8" }, (err, stdout) => {
			return err ? rej(err) : res(stdout.trim());
		})
	);
}
