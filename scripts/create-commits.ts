// Turns a JSON array of api.json snapshots (e.g. result.json from
// `npm run timeline -- <export.json>`) into backdated 📍 commits.
// Usage: npm run commits -- result.json
import { execFileSync } from "child_process";
import { readFile, writeFile } from "fs/promises";
import type { ApiResult } from "../src/types";

const main = async () => {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run commits -- <snapshots.json>");
  const snapshots = JSON.parse(await readFile(file, "utf-8")) as ApiResult[];

  for (const snapshot of snapshots) {
    await writeFile("api.json", `${JSON.stringify(snapshot, null, 2)}\n`);
    const date = new Date(snapshot.date).toISOString();
    execFileSync("git", ["add", "api.json"], { stdio: "inherit" });
    execFileSync(
      "git",
      ["commit", "-m", `📍${snapshot.country_emoji} ${snapshot.label}`],
      {
        stdio: "inherit",
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      }
    );
    console.log("Added", snapshot.label);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
