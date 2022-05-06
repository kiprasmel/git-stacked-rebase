#!/usr/bin/env ts-node-dev

import { testCase } from "./experiment.spec";
import reducePathTC from "../reducePath.spec";

import { sequentialResolve } from "../util/sequentialResolve";

main();
function main() {
	// TODO Promise.all
	sequentialResolve([
		testCase, //
		async () => reducePathTC(),
	])
		.then(() => process.stdout.write("\nsuccess\n\n"))
		.catch((e) => {
			process.stderr.write("\nfailure: " + e + "\n\n");
			process.exit(1);
		});
}
