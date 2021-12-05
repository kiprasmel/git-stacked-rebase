const isLockedKey = Symbol("isLocked");

export type Unlocked<T> = T[] & { [isLockedKey]: false };
export type Locked<T> = T[] & { [isLockedKey]: true };
export type Lockable<T> = Unlocked<T> | Locked<T>;

const isLocked = <T>(array: Lockable<T>): boolean => array[isLockedKey];

/**
 * marks the array as locked.
 *
 * pushing is still allowed, but will no longer
 * add items to the array.
 *
 */
export const lock = <T>(array: Lockable<T>): Locked<T> =>
	Object.assign(
		array, //
		{ [isLockedKey]: true } as const
	);

/**
 * import `lock` to lock the array.
 */
export const createLockableArray = <T>(initialItems: T[] = []): Lockable<T> => {
	const array: Unlocked<T> = Object.assign(
		initialItems, //
		{ [isLockedKey]: false } as const
	);

	const push = (item: T): typeof array["length"] => {
		if (!isLocked(array)) {
			Array.prototype.push.call(array, item);
		}
		return array.length;
	};

	array.push = push;

	return array;
};
