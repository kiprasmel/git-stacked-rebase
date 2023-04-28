export function removeUndefinedProperties<T, U extends Partial<T>>(object: U): T {
	for (const key in object) {
		if (object[key] === undefined) {
			delete object[key];
		}
	}

	return object as unknown as T;
	/**
	 * TODO TS - we're not doing what we're saying we're doing here.
	 *
	 * we're simply deleting undefined properties,
	 * but in the type system, we're saying that "we are adding legit values to properties who were undefined",
	 * which is obviously incorrect.
	 */
}
