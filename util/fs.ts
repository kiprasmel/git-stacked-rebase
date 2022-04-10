import fs from "fs";

export const isDirEmptySync = (dirPath: fs.PathLike): boolean => fs.readdirSync(dirPath).length === 0;
