import { simpleGit } from "simple-git";
import { writeFile } from "fs/promises";
import { ApiResult } from "..";

const git = simpleGit({});
type T = Omit<ApiResult, "country" | "timezone"> & {
  country: Partial<ApiResult["country"]>;
  timezone: Partial<ApiResult["timezone"]>;
};

export const summarize = async () => {
  const log = await git.log({ file: "api.json" });
  const commits = log.all.filter((commit) => commit.message.startsWith("📍"));
  const data: T[] = [];
  for (const commit of commits) {
    const show = JSON.parse(await git.show(`${commit.hash}:api.json`)) as T;
    delete show.country.timezones;
    delete show.timezone?.utcOffsetStr;
    delete show.timezone?.dstOffsetStr;
    delete show.timezone?.aliasOf;
    delete show.timezone?.countries;
    data.push(show);
  }
  await writeFile(
    "history.json",
    JSON.stringify(
      data.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
      null,
      2
    ) + "\n"
  );
};

summarize();
