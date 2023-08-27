#!/usr/bin/env ts-node-dev

import assert from "assert";

import Git from "nodegit";

import { CommitAndBranchBoundary, gitStackedRebase, referenceToOid } from "./git-stacked-rebase";
import { askQuestion__internal } from "./internal";
import { RangeDiff, RepairableRef, refFinder } from "./ref-finder";

import { AskQuestion, question } from "./util/createQuestion";
import { Termination } from "./util/error";
import { log } from "./util/log";
import { stdout } from "./util/stdout";

export type RepairCtx = {
	initialBranch: Git.Reference;
	currentBranch: Git.Reference;
	askQuestion: AskQuestion;
	commitsWithBranchBoundaries: CommitAndBranchBoundary[];
	repo: Git.Repository;
}

export async function repair({
	initialBranch,
	currentBranch,
	askQuestion,
	commitsWithBranchBoundaries,
	repo,
}: RepairCtx): Promise<void> {
	const initialBranchCommit: string = await referenceToOid(initialBranch).then(x => x.tostrS());

	const autoRepairableRefs: RepairableRef[] = await findAutoRepairableRefs({
		initialBranch: initialBranch.name(),
		initialBranchCommit,
		latestBranch: currentBranch.name(),
		askQuestion,
	});

	log({ autoRepairableRefs });

	const ref_repaired_sha_index: Map<RepairableRef["refname"], number> = new Map(autoRepairableRefs.map(r => [r.refname, 0]));
	const refs_in_progress: Set<RepairableRef["refname"]> = new Set();

	for (let i = 0; i < commitsWithBranchBoundaries.length; i++) {
		const bb = commitsWithBranchBoundaries[i];
		const bb_commit_sha: string = bb.commit.sha();

		let added_new_commits = 0;

		const insertCommit = (newCommit: CommitAndBranchBoundary): void => void commitsWithBranchBoundaries.splice(i + (++added_new_commits), 0, newCommit);

		/**
		 * either has not been replaced yet,
		 *
		 * or if has been replaced already,
		 * then the replacement commit must match in all refs that need replacing;
		 * otherwise undefined behavior.
		 *
		 */
		let current_commit_has_been_replaced_by_sha: string | null = null;
		const refs_repairing_current_sha: Map<RepairableRef["refname"], RepairableRef["range_diff_parsed"][number]["sha_after_full"]> = new Map(); // DEBUG

		for (const ref of autoRepairableRefs) {
			const { refname } = ref;
			let repair_nth_sha: number = ref_repaired_sha_index.get(refname)!;
			const incr_ref_sha_index = () => ref_repaired_sha_index.set(refname, ++repair_nth_sha);

			const ref_already_finished: boolean = repair_nth_sha === ref.easy_repair_scenario.behind_from + 1; // TODO verify - idk if need + 1
			if (ref_already_finished) {
				continue;
			}

			const delta: RangeDiff = ref.range_diff_parsed[repair_nth_sha];

			const isAhead = () => ref.range_diff_parsed[i].eq_sign === "<"
			if (isAhead()) {
				let delta_tmp: RangeDiff
				while ((delta_tmp = ref.range_diff_parsed[i]) && isAhead()) {
					const extraCommit: CommitAndBranchBoundary = {
						commit: await Git.Commit.lookup(repo, delta.sha_after_full),
						commitCommand: "pick",
						branchEnd: null,
						branchEndCommands: null,
					};

					insertCommit(extraCommit);
				}

				continue; // TODO: wat do if other refs want to be pointing to earlier sha, but we incremented `i`?
			}

			const old_sha_to_find: string = delta.sha_before_full;

			const found_sha: boolean = bb_commit_sha === old_sha_to_find;

			if (!found_sha) {
				if (refs_in_progress.has(refname)) {
					const msg = `\nref "${refname}" repair was in progress, reached repair index ${repair_nth_sha}, but did not find matching SHA in latest.\n\n`;
					throw new Termination(msg);
				} else {
					continue;
				}
			} else {
				if (!refs_in_progress.has(refname)) {
					refs_in_progress.add(refname);

					/**
					 * TODO: insert comment that it's the start of repairment of `ref`
					 */
				}
				refs_repairing_current_sha.set(refname, delta.sha_after_full);

				if (!current_commit_has_been_replaced_by_sha) {
					/** drop the current commit */
					bb.commitCommand = "drop";

					/**
					 * drop the branchEnd -- will get a new one assigned
					 * from the diverged branch (once done)
					 */
					bb.branchEnd = null;

					/** add new */
					insertCommit({
						commit: await Git.Commit.lookup(repo, delta.sha_after_full),
						commitCommand: "pick",
						branchEnd: null,
						branchEndCommands: null,
					});

					/** mark as added */
					current_commit_has_been_replaced_by_sha = delta.sha_after_full;
				} else {
					/** verify that the replacement sha is the same as we have for replacement. */
					const replaced_sha_is_same_as_our_replacement = current_commit_has_been_replaced_by_sha === delta.sha_after_full;

					if (!replaced_sha_is_same_as_our_replacement) {
						const old_sha = `old sha: ${old_sha_to_find}`;
						const repairing_refs = [...refs_repairing_current_sha.entries()];
						const longest_refname: number = repairing_refs.map(([name]) => name.length).reduce((acc, curr) => Math.max(acc, curr), 0);

						const progress = repairing_refs.map(([name, sha]) => name.padEnd(longest_refname, " ") + ": " + sha).join("\n");
						const msg = `\nmultiple refs want to repair the same SHA, but their resulting commit SHAs differ:\n\n` + old_sha + "\n\n" + progress + "\n\n";

						throw new Termination(msg);
					}
				}

				incr_ref_sha_index();
			}

			const just_finished_ref: boolean = repair_nth_sha === ref.easy_repair_scenario.behind_from;

			if (just_finished_ref) {
				refs_in_progress.delete(refname);
				incr_ref_sha_index(); // mark as done

				/**
				 * insert extra commits
				 *
				 * TODO: if multiple refs, is this good?
				 *
				 * because then, ref order matters..
				 * & could get merge conflicts
				 *
				 */
				if (ref.easy_repair_scenario.ahead_count) {
					for (let delta_idx = ref.easy_repair_scenario.ahead_from; delta_idx < ref.easy_repair_scenario.ahead_till; delta_idx++) {
						const delta = ref.range_diff_parsed[delta_idx];

						const extraCommit: CommitAndBranchBoundary = {
							commit: await Git.Commit.lookup(repo, delta.sha_after_full),
							commitCommand: "pick",
							branchEnd: null,
							branchEndCommands: null,
						};

						insertCommit(extraCommit);
					}
				}

				/**
				 * add the branchEnd to the latest commit.
				 *
				 * note: previous commits (which are now replaced) might've had branchEnds -
				 * those branchEnds have been removed in the repair process.
				 *
				 * if there's some branchEnds on the commit,
				 * they're coming from other refs.
				 */
				const latest_commit_idx = i + added_new_commits;

				if (!commitsWithBranchBoundaries[latest_commit_idx].branchEnd) {
					commitsWithBranchBoundaries[latest_commit_idx].branchEnd = [];
					commitsWithBranchBoundaries[latest_commit_idx].branchEndCommands = new Map();
				}

				const adjustedBranchEnd: Git.Reference = await Git.Branch.lookup(repo, ref.refnameshort, Git.Branch.BRANCH.ALL);
				commitsWithBranchBoundaries[latest_commit_idx].branchEnd!.push(adjustedBranchEnd);
				commitsWithBranchBoundaries[latest_commit_idx].branchEndCommands!.set(ref.refname, "branch-end-reset");

				// TODO: add comment that finished repairing ref
				// tho, prolly pretty obvious since the new branch-end will be there?
				continue;
			}
		}

		i += added_new_commits;
	}

	assert.deepStrictEqual(refs_in_progress.size, 0, `expected all refs to have finished repairing, but ${refs_in_progress.size} are still in progress.\n`);

	log({ commitsWithBranchBoundaries });
}

export type FindAutoRepairableRefsCtx = {
	initialBranch: string;
	initialBranchCommit: string;
	latestBranch: string;
	askQuestion: AskQuestion;
}

export async function findAutoRepairableRefs({
	initialBranch,
	initialBranchCommit,
	latestBranch,
	askQuestion,
}: FindAutoRepairableRefsCtx): Promise<RepairableRef[]> {
	stdout(`finding repairable refs...\n`)
	const candidateRefs: RepairableRef[] = await refFinder({
		INITIAL_BRANCH: initialBranch,
		INITIAL_BRANCH_COMMIT: initialBranchCommit,
		LATEST_BRANCH: latestBranch,
	})

	const autoRepairableRefs: RepairableRef[] = []
	const nonAutoRepairableRefs: RepairableRef[] = []

	for (const ref of candidateRefs) {
		const isAutoRepairable: boolean = ref.easy_repair_scenario.is_easy_repair_scenario

		if (isAutoRepairable) {
			autoRepairableRefs.push(ref)
		} else {
			nonAutoRepairableRefs.push(ref)
		}
	}

	stdout(`${candidateRefs.length} candidates found.\n`)

	if (nonAutoRepairableRefs.length) {
		stdout(`\n${nonAutoRepairableRefs.length} refs that cannot be auto-repaired:\n`)
		stdout(nonAutoRepairableRefs.map(r => r.refname).join("\n") + "\n")
	} else {
		stdout(`\n0 refs that cannot be auto-repaired.`)
	}

	if (!autoRepairableRefs.length) {
		const msg = `\nnothing to do: 0 auto-repairable refs found. exiting.\n\n`
		throw new Termination(msg, 0)
	}

	stdout(`\n${autoRepairableRefs.length} refs that can be auto-repaired:\n`)

	for (let i = 0; i < autoRepairableRefs.length; i++) {
		const ref = autoRepairableRefs[i]

		const nth = i + 1
		const nth_str = nth.toString().padStart(autoRepairableRefs.length.toString().length, " ")
		const nth_info = `  ${nth_str}`

		stdout(`${nth_info} ${ref.refname}\n`)
	}

	const q = `\nRepair all? [Y/n/<selection of numbers to repair>] `
	const ans: string = (await askQuestion(q)).trim().toLowerCase()

	const choices: string[] = ans.replace(/\s+/g, ",").split(",")
	let allowedIndices: number[] | null = null

	const refAllowedToBeRepaired = (idx: number): boolean => {
		if (!ans || ans === "y") return true
		if (ans === "n") return false

		if (!choices.length || (choices.length === 1 && !choices[0].trim())) return false

		if (!allowedIndices) {
			allowedIndices = parseChoicesRanges(choices)
		}

		return allowedIndices.includes(idx)
	}

	const allowedToRepairRefs: RepairableRef[] = autoRepairableRefs.filter((_, i) => refAllowedToBeRepaired(i))
	return allowedToRepairRefs
}

export function parseChoicesRanges(choices: string[]) {
	const allowed: number[] = []

	for (const choice of choices) {
		const isRange = choice.includes("-")

		if (isRange) {
			const choicesNum: number[] = choice.split("-").map(Number)

			if (choicesNum.length !== 2) throw new Termination(`\ninvalid format "${choice}".\n\n`)
			if (choicesNum.some(x => Number.isNaN(x))) throw new Termination(`\ninvalid format "${choice}" - not a number found.\n\n`)

			const [from, to] = choicesNum

			for (let i = from; i <= to; i++) {
				allowed.push(i)
			}
		} else {
			const choiceNum: number = Number(choice)
			if (Number.isNaN(choiceNum)) throw new Termination(`\ninvalid format "${choice}" - not a number.\n\n`)
			allowed.push(choiceNum)
		}
	}

	const allowedIndices = allowed.map(x => x - 1)
	return allowedIndices
}

if (!module.parent) {
	if (process.env.GSR_DEBUG || process.env.GSR_DEBUG_REPAIR) {
		gitStackedRebase({
			initialBranch: "origin/master",
			repair: true,
			[askQuestion__internal]: (q, ...rest) => {
				if (q.includes("Repair all?")) {
					return "y" /** can modify easily here */
				}
	
				return question(q, ...rest)
			}
		})
	} else {
		gitStackedRebase({
			initialBranch: "origin/master",
			repair: true,
		})
	}
}
