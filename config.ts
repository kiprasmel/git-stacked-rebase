/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";

import { SomeOptionsForGitStackedRebase } from "./options";
import { getGitConfig__internal } from "./internal";

export const configKeyPrefix = "stackedrebase" as const;

export const configKeys = {
	gpgSign: "commit.gpgSign",
	autoApplyIfNeeded: `${configKeyPrefix}.autoApplyIfNeeded`,
	autoSquash: "rebase.autoSquash",
} as const;

export async function loadGitConfig(
	repo: Git.Repository,
	specifiedOptions: SomeOptionsForGitStackedRebase
): Promise<Git.Config> {
	return getGitConfig__internal in specifiedOptions
		? await specifiedOptions[getGitConfig__internal]!({ GitConfig: Git.Config, repo })
		: await Git.Config.openDefault();
}

export type ConfigValues = {
	gpgSign: boolean;
	autoApplyIfNeeded: boolean;
	autoSquash: boolean;
};

export async function parseGitConfigValues(config: Git.Config): Promise<ConfigValues> {
	const configValues: ConfigValues = {
		gpgSign: !!(await config.getBool(configKeys.gpgSign).catch(() => 0)),
		autoApplyIfNeeded: !!(await config.getBool(configKeys.autoApplyIfNeeded).catch(() => 0)),
		autoSquash: !!(await config.getBool(configKeys.autoSquash).catch(() => 0)),
	};

	return configValues;
}
