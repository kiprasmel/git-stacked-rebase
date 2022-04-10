#!/usr/bin/env ts-node-dev

import { testCase } from "./experiment.spec";

main();
function main() {
	testCase()
		.then(() => process.stdout.write("\nsuccess\n\n"))
		.catch((e) => {
			process.stderr.write("\nfailure: " + e + "\n\n");
			process.exit(1);
		});
}
