import fs from "fs";

export const isDirEmptySync = (dirPath: fs.PathLike): boolean => fs.readdirSync(dirPath).length === 0;

/** node mantainers are a-holes for this breaking change */
export const rmdirSyncR = (dir: fs.PathLike) => fs.rmdirSync(dir, { recursive: true, ...{ force: true } });
