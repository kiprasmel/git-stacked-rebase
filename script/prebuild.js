#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "dist");
if (fs.existsSync(dir)) {
	fs.rmdirSync(dir, { recursive: true, force: true });
}
