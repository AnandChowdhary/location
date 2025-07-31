import * as dayjs from "dayjs";
import { ApiResult } from "..";

// @ts-ignore
import { execSync } from "child_process";
// @ts-ignore
import { readFile, writeFile } from "fs/promises";

export const createCommits = async () => {
  const data = await readFile(
    "/Users/anandchowdhary/Downloads/Untitled-1.json",
    "utf8"
  );

  for (const item of JSON.parse(data)) {
    const data: ApiResult = item;
    await writeFile("api.json", JSON.stringify(data, null, 2) + "\n");
    const date = dayjs(item.date).format("ddd MMM DD HH:mm:ss YYYY ZZ");
    console.log(
      execSync(
        `git add . && GIT_AUTHOR_DATE="${date}" GIT_COMMITTER_DATE="${date}" git commit -m "📍${item.country_emoji} ${item.label}"`,
        { stdio: "inherit" }
      )
    );
    console.log("Added", item.label);
  }
};

createCommits();
