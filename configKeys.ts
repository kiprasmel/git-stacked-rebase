export const configKeyPrefix = "stackedrebase" as const;

export const configKeys = {
	gpgSign: "commit.gpgSign",
	autoApplyIfNeeded: `${configKeyPrefix}.autoApplyIfNeeded`,
} as const;
