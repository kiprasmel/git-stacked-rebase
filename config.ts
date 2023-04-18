/* eslint-disable @typescript-eslint/camelcase */

import Git from "nodegit";

import { SpecifiableGitStackedRebaseOptions } from "./options";
import { getGitConfig__internal } from "./internal";

export const configKeyPrefix = "stackedrebase" as const;

export type ConfigKeys = typeof configKeys;
export type ConfigKey = keyof ConfigKeys;

export const configKeys = {
	gpgSign: "commit.gpgSign",
	autoApplyIfNeeded: `${configKeyPrefix}.autoApplyIfNeeded`,
	autoSquash: "rebase.autoSquash",
} as const;

export async function loadGitConfig(
	repo: Git.Repository,
	specifiedOptions: SpecifiableGitStackedRebaseOptions
): Promise<Git.Config> {
	return getGitConfig__internal in specifiedOptions
		? await specifiedOptions[getGitConfig__internal]!({ GitConfig: Git.Config, repo })
		: await Git.Config.openDefault();
}

export type ConfigValues = {
	gpgSign: boolean | undefined;
	autoApplyIfNeeded: boolean | undefined;
	autoSquash: boolean | undefined;
};

export async function resolveGitConfigValues(config: Git.Config): Promise<ConfigValues> {
	const [
		gpgSign, //
		autoApplyIfNeeded,
		autoSquash,
	] = await Promise.all([
		resolveConfigBooleanValue(config.getBool(configKeys.gpgSign)),
		resolveConfigBooleanValue(config.getBool(configKeys.autoApplyIfNeeded)),
		resolveConfigBooleanValue(config.getBool(configKeys.autoSquash)),
	]);

	const configValues: ConfigValues = {
		gpgSign,
		autoApplyIfNeeded,
		autoSquash,
	};

	return configValues;
}

/**
 * there's a difference between a value set to false (intentionally disabled),
 * vs not set at all:
 * can then look thru lower level options providers, and take their value.
 *
 * ```
 * export const handleConfigBooleanValue = (x: Promise<number>) => x.then(Boolean).catch(() => undefined);
 * ```
 *
 * but actually, it doesn't matter here, because when we're trying to resolve (here),
 * our goal is to provide a final value that will be used by the program,
 * thus no `undefined`.
 *
 */
//
export const resolveConfigBooleanValue = (x: Promise<number>) => x.then(Boolean).catch(() => false);
