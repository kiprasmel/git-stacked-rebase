/* eslint-disable indent */

export enum ExitCode {
	SUCC = 0,
	FAIL = 1,
}

export type ExitSucc<T> = {
	code: ExitCode.SUCC;
	stdout: string;
	stderr?: never;
} & ({} | never extends T
	? {
			return?: never;
	  }
	: {
			return: T;
	  });

export type ExitFail<_T> = {
	code: ExitCode.FAIL;
	stdout?: never;
	stderr: string;
};

export type Exitable<T = {}> = ExitSucc<T> | ExitFail<T>;

export const succ = <T>(ret?: ExitSucc<T>["return"], stdout: string = ""): ExitSucc<T> => ({
	return: ret as any, // TS should infer
	stdout,
	code: ExitCode.SUCC,
});

// export const fail = <T>(args: Exclude<ExitFail<T>, "code"> = { code: "fail" }): ExitFail<T> => ({
export const fail = <T>(stderr: ExitFail<T>["stderr"] = ""): ExitFail<T> => ({
	stderr,
	code: ExitCode.FAIL,
});

export const processWrite = <T>(exit: Exitable<T>): typeof exit => (
	exit.code === ExitCode.SUCC && exit.stdout
		? process.stdout.write(exit.stdout)
		: exit.code === ExitCode.FAIL && exit.stderr
		? process.stderr.write(exit.stderr)
		: void 0,
	exit
);

export const processWriteAndExit = <T>(exit: Exitable<T>): void => (
	processWrite(exit), //
	process.exit(exit.code)
);
