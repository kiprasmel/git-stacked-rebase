/**
 * ...because eslint >5 sucks
 */

export type Single<A> = [A];
export type ReadonlySingle<A> = readonly [A];

export type Tuple<A, B> = [A, B];
export type ReadonlyTuple<A, B> = readonly [A, B];
