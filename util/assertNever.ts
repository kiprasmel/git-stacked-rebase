export function assertNever(_x: never): never {
	throw new Error(`assertNever called (with value ${_x}) - should've been disallowed at compile-time`);
}
