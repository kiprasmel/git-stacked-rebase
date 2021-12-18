/* eslint-disable indent */

// export enum ExitCode {
// 	SUCC = 0,
// 	FAIL = 1,
// }

// export type ExitSucc<T> = {
// 	code: ExitCode.SUCC;
// 	stdout: string;
// 	stderr?: never;
// } & ({} | never extends T
// 	? {
// 			return?: never;
// 	  }
// 	: {
// 			return: T;
// 	  });

// export type ExitFail<_T> = {
// 	code: ExitCode.FAIL;
// 	stdout?: never;
// 	stderr: string;
// };

// export type Exitable<T = {}> = ExitSucc<T> | ExitFail<T>;

// export const succ = <T>(ret?: ExitSucc<T>["return"], stdout: string = ""): ExitSucc<T> => ({
// 	return: ret as any, // TS should infer
// 	stdout,
// 	code: ExitCode.SUCC,
// });

// // export const fail = <T>(args: Exclude<ExitFail<T>, "code"> = { code: "fail" }): ExitFail<T> => ({
// export const fail = <T>(stderr: ExitFail<T>["stderr"] = ""): ExitFail<T> => ({
// 	stderr,
// 	code: ExitCode.FAIL,
// });

// export const processWrite = <T>(exit: Exitable<T>): typeof exit => (
// 	exit.code === ExitCode.SUCC && exit.stdout
// 		? process.stdout.write(exit.stdout)
// 		: exit.code === ExitCode.FAIL && exit.stderr
// 		? process.stderr.write(exit.stderr)
// 		: void 0,
// 	exit
// );

// export const processWriteAndExit = <T>(exit: Exit): void => (
// 	processWrite(exit), //
// 	process.exit(exit.code)
// );

/**
 * ---
 *
 * change of pace.
 * we're no longer FP programmers — we're now C programmers.
 *
 * ((Gr393iDnN))
 *
 * ---
 */

// // export type Exit = { code: ExitCode; stderr?: string } | void;
// export type MaybeFail = void | { code: 1; stderr?: string };

// export type ExitFail = readonly [MaybeFail, null] // TODO ESLINT
// export type ExitSucc<Succ> = readonly [null, Succ] // TODO ESLINT

// // export type MaybeExit<T = undefined> = Exit | T;
// export type EitherExit<Succ = undefined> = ExitFail | ExitSucc<Succ>;
// export type Exit = { code: ExitCode; stderr?: string } | void;

// export type MaybeFail = { code: 1; stderr?: string };

// export const neutral = Symbol("neutral")
export const neutral = null
export type Neutral = typeof neutral

// export type MaybeFail = string;
export type MaybeFail = string | Neutral;

// const emptySucc = Symbol("success")

export type ExitFail = readonly [MaybeFail, Neutral] // TODO ESLINT
export type ExitSucc<Succ = Neutral> = readonly [Neutral, Succ] // TODO ESLINT

// export type MaybeExit<T = undefined> = Exit | T;
export type EitherExit<Succ = void> = ExitFail | ExitSucc<Succ>;

export type EitherExitFinal = void | EitherExit<Neutral>;

// export const fail = <T>(args: Exclude<ExitFail<T>, "code"> = { code: "fail" }): ExitFail<T> => ({
// export const fail = (stderr: string = ""): ExitFail => [
// 	{
// 		stderr,
// 		code: ExitCode.FAIL,
// 	},
// 	null
// ];

/**
 * left
 */
// export const failRet = (stderr: string = ""): ExitFail => [
// 	{
// 		stderr,
// 		// code: ExitCode.FAIL,
// 		code: 1,
// 	},
// 	null,
// ];

export const fail = (stderr: MaybeFail | Neutral = ""): ExitFail => [stderr, neutral];

/**
 * unwrap left
 */
// export const fail = (stderr: string = "") => failRet(stderr)[0];

// export type succ = {
// 	(): ExitSucc<null>
// 	<T>(ret: T): ExitSucc<T>
// }

/**
 * right
 */
export const succ = <T>(ret: T): ExitSucc<T> => [neutral, ret];

/**
 * TODO
 */
// export const succFinal = (): ExitSucc<Neutral> => [neutral, neutral]

/**
 *
 */
// export const processWriteAndOrExit = (exit: MaybeFail): void => (
// 	!exit //
// 		? process.exit(0)
// 		: (exit.stderr && process.stderr.write(exit.stderr), //
// 		  process.exit(exit.code)),
// 	void 0
// );

/**
 *
 */
export const processWriteAndOrExit = <T>(exit: EitherExit<T> | EitherExitFinal): void => (
	// !exit || exit[0] === neutral //
	!exit || (exit[1] || exit[1] === neutral) //
		? process.exit(0)
		: (exit[0] && process.stderr.write(exit[0]), //
		  process.exit(1)),
	void 0
);
