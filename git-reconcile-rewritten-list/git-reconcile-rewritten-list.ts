#!/usr/bin/env node

export * from "./postRewriteHook";
export * from "./combineRewrittenLists";

// eslint-disable-next-line @typescript-eslint/camelcase
async function git_reconcile_rewritten_list_CLI(): Promise<void> {
	/**
	 * TODO
	 */

	process.stderr.write("\nCLI not implemented yet.\n\n");
	process.exit(1);
}

if (!module.parent) {
	git_reconcile_rewritten_list_CLI();
}
