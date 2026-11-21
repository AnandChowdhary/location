import { readFile, writeFile } from "fs/promises";
import { loadHistoryEntries } from "../src/git";
import { buildHistory, historyFiles } from "../src/history";
import type { Overwrite } from "../src/types";

const main = async () => {
  const overwrite = JSON.parse(await readFile("overwrite.json", "utf-8")) as Overwrite;
  const history = buildHistory(loadHistoryEntries(), overwrite, new Date());
  for (const [file, contents] of Object.entries(historyFiles(history)))
    await writeFile(file, contents);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
