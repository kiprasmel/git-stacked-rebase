export const configKeyPrefix = "stackedrebase" as const;

export const configKeys = {
	gpgSign: "commit.gpgSign",
	autoApplyIfNeeded: `${configKeyPrefix}.autoApplyIfNeeded`,
	autoSquash: "rebase.autoSquash",
} as const;
