#!/usr/bin/env ts-node-dev

import { testCase } from "./experiment.spec";
import reducePathTC from "../git-reconcile-rewritten-list/reducePath.spec";
import { parseNewGoodCommandsSpec } from "../parse-todo-of-stacked-rebase/parseNewGoodCommands.spec";
import autoCheckoutRemotePartialBranchesTC from "./auto-checkout-remote-partial-branches.spec";
import { applyTC } from "./apply.spec";

import { sequentialResolve } from "../util/sequentialResolve";
import { cleanupTmpRepos } from "./util/tmpdir";

main();
function main() {
	// TODO Promise.all
	sequentialResolve([
		testCase, //
		async () => reducePathTC(),
		parseNewGoodCommandsSpec,
		autoCheckoutRemotePartialBranchesTC,
		applyTC,
	])
		.then(cleanupTmpRepos)
		.then(() => {
			process.stdout.write("\nsuccess\n\n");
			process.exit(0);
		})
		.catch((e) => {
			process.stderr.write("\nfailure: " + e + "\n\n");
			process.exit(1);
		});
}
