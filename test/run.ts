#!/usr/bin/env ts-node-dev

import { testCase } from "./experiment.spec";
import reducePathTC from "../reducePath.spec";

main();
function main() {
	Promise.all([
		testCase(), //
		reducePathTC(),
	])
		.then(() => process.stdout.write("\nsuccess\n\n"))
		.catch((e) => {
			process.stderr.write("\nfailure: " + e + "\n\n");
			process.exit(1);
		});
}
