#!/usr/bin/env ts-node-dev

import { gitStackedRebase } from "./git-stacked-rebase";
import { askQuestion__internal } from "./internal";
import { RepairableRef, refFinder } from "./ref-finder";

import { AskQuestion, question } from "./util/createQuestion";
import { Termination } from "./util/error";

export type RepairCtx = {
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
}: RepairCtx): Promise<RepairableRef[]> {
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

	// const repairInfo = `${candidateRefs.length} refs found for repairing, ${autoRepairableRefs.length} of them auto-repairable.\n\n`
	// stdout(repairInfo)
	stdout(`${candidateRefs.length} candidates found.\n`)

	if (nonAutoRepairableRefs.length) {
		stdout(`\n${nonAutoRepairableRefs.length} refs that cannot be auto-repaired:\n`)
		stdout(nonAutoRepairableRefs.map(r => r.refname).join("\n") + "\n")
	} else {
		stdout(`\n0 refs that cannot be auto-repaired.`)
	}

	if (!autoRepairableRefs.length) {
		const msg = `0 auto-repairable refs found. exiting.\n`
		stdout(msg)
		return []
	}

	stdout(`\n${autoRepairableRefs.length} refs that can be auto-repaired:\n`)

	for (let i = 0; i < autoRepairableRefs.length; i++) {
		const ref = autoRepairableRefs[i]

		const nth = i + 1
		const nth_str = nth.toString().padStart(autoRepairableRefs.length.toString().length, " ")
		// const nth_info = `[${nth_str}/${autoRepairableRefs.length}]`
		const nth_info = `  ${nth_str}`

		stdout(`${nth_info} ${ref.refname}\n`)

		// const isAutoRepairable: boolean = ref.is_easy_repair_scenario_and_can_automatically_generate_rewritten_list.is_easy_repair_scenario
		// if (!isAutoRepairable) {
		// 	const msg = `${nth_info} ref "${ref.refname}" is not auto-repairable. skipping.\n`
		// 	stdout(msg)
		// 	continue
		// }

		// const q = `${nth_info} ref "${ref.refname}" is auto-repairable. Repair? [Y / n / repair (a)ll / (p)rint info] `
		// const _ans: string = await askQuestion(q, { cb: (ans) => ans.trim().toLowerCase() });
		// console.log({ans})
		// stdout("\n")
	}

	// const q = `\nWhich refs do you want to auto-repair? `
	// const suffix = [
	// 	`\nEnter:`,
	// 	`- a selection of numbers (1,2,5)`,
	// 	`- a range of numbers (1-5)`,
	// 	`- a combination of above, or "all".`,
	// 	`> `,
	// ].join("\n")

	const q = `\nRepair all? [Y/n/<selection of numbers to repair>] `

	// const ans: string = await askQuestion(q, { suffix })
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

	const allowedToRepairRefs: RepairableRef[] = []
	for (let i = 0; i < autoRepairableRefs.length; i++) {
		const ref = autoRepairableRefs[i]
		const repairInfo = ref.easy_repair_scenario

		stdout(`${ref.refname}:\n`)

		/**
		 * TODO: only repair if user picked
		 */
		const allowed = refAllowedToBeRepaired(i)
		stdout(`allowed: ${allowed}\n`)

		if (!allowed) {
			continue
		}

		allowedToRepairRefs.push(ref)

		for (let j = repairInfo.eq_from; j < repairInfo.eq_till; j++) {
			const rd = ref.range_diff_parsed[j]

			const msg = [
				`drop ${rd.sha_before}`,
				`pick ${rd.sha_after}`,
			].join("\n")
			stdout(msg + "\n")
		}

		// - pick commits into latest
		if (repairInfo.ahead_count > 0) {
			stdout(`# extra because ahead: \n`)

			for (let j = repairInfo.ahead_from; j < repairInfo.ahead_till; j++) {
				const rd = ref.range_diff_parsed[j]

				const sha_rewrite_msg = `pick ${rd.sha_before}\n`
				stdout(sha_rewrite_msg)
			}
		}

		// - reset branch to latest
		stdout(`reset ${ref.refname}\n`)

		stdout(`\n`)
	}

	return allowedToRepairRefs
}

const stdout = (msg: string) => process.stdout.write(msg)

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
