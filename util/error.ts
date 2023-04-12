export class Termination extends Error {
	constructor(public message: string, public exitCode: number = 1) {
		super(message);
	}
}
