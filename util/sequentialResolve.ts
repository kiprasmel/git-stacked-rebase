export const sequentialResolve = <T>(xs: (() => Promise<T>)[]): Promise<T> =>
	xs.reduce(
		(prev, curr) => prev.then(curr), //
		(Promise.resolve() as unknown) as Promise<T>
	);
