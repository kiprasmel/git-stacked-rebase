export function removeUndefinedProperties<T, K extends keyof Partial<T>>(
	object: Partial<T> //
): Partial<T> {
	return (
		Object.keys(object).forEach(
			(k) =>
				k in object && //
				object[k as K] === undefined &&
				delete object[k as K]
		),
		object
	);
}
