import assert from "assert";

import { reducePath } from "./reducePath";

export default function testcase() {
	const obj1 = {
		a: "b",
		b: "c",
		c: "d",
		d: "e",

		g: "h",

		x: "x",

		y: "z",
		z: "z",

		/**
		 * this might mean that we need to go backwards
		 * rather than forwards
		 * (multiple commits can be reported as rewritten into one,
		 * but i don't think the opposite is possible)
		 *
		 * ~~and/or we might need another phase,
		 * because currently, A -> F,
		 * and both B and C stay at D.~~
		 * done
		 *
		 */
		A: "D",
		B: "D",
		C: "D",
		D: "E",
		E: "F",
	};

	reducePath(obj1);
	console.log(obj1);

	assert.deepStrictEqual(obj1, {
		a: "e",

		g: "h",

		x: "x",

		y: "z",

		A: "F",
		B: "F",
		C: "F",
	});
}
