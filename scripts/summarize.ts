import { simpleGit } from "simple-git";
import { writeFile } from "fs/promises";
import { ApiResult } from "..";

const git = simpleGit({});
type T = Omit<ApiResult, "country" | "timezone"> & {
  country: Partial<ApiResult["country"]>;
  timezone: Partial<ApiResult["timezone"]>;
  hash: string;
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
    data.push({ ...show, hash: commit.hash });
  }
  await writeFile(
    "history-full.json",
    JSON.stringify(
      data.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
      null,
      2
    ) + "\n"
  );

  const locationResult: T[] = [];
  let skipped: (T & { duration: number })[] = [];
  data
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    )
    .forEach((location, index, array) => {
      const previous = array[index - 1];
      if (previous) {
        const a =
          previous.approximateCoordinates[0] -
          location.approximateCoordinates[0];
        const b =
          previous.approximateCoordinates[1] -
          location.approximateCoordinates[1];
        const c = Math.sqrt(a * a + b * b);
        if (
          c > 2 ||
          (location.country?.code &&
            previous.country?.code &&
            location.country?.code?.toLocaleLowerCase() !==
              previous.country?.code?.toLocaleLowerCase()) ||
          location.timezone?.name !== previous.timezone?.name
        ) {
          if (skipped.length) {
            const items: Record<string, number> = {};
            skipped.forEach((item) => {
              items[item.label] = (items[item.label] || 0) + item.duration;
            });
            if (
              locationResult[locationResult.length - 1]?.label !==
              skipped.sort((a, b) => b.duration - a.duration)[0].label
            ) {
              const item = skipped.sort((a, b) => b.duration - a.duration)[0];
              locationResult.push(item);
            }
          } else {
            if (
              locationResult[locationResult.length - 1]?.label !==
              location.label
            )
              locationResult.push(location);
          }
          skipped = [];
        } else {
          console.log("skipping", location.updatedAt, location.label);
          skipped.push({
            ...location,
            duration: array[index + 1]
              ? new Date(array[index + 1].updatedAt).getTime() -
                new Date(location.updatedAt).getTime()
              : 0,
          });
        }
      } else {
        if (locationResult[locationResult.length - 1]?.label !== location.label)
          locationResult.push(location);
        skipped = [];
      }
    });
  if (skipped.length) {
    const items: Record<string, number> = {};
    skipped[skipped.length - 1].duration =
      new Date().getTime() -
      new Date(skipped[skipped.length - 1].updatedAt).getTime();
    skipped.forEach((item) => {
      items[item.label] = (items[item.label] || 0) + item.duration;
    });
    locationResult.push(skipped.sort((a, b) => b.duration - a.duration)[0]);
  }
  await writeFile(
    "history.json",
    JSON.stringify(
      locationResult.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
      null,
      2
    ) + "\n"
  );
  await writeFile(
    "history-unique.json",
    JSON.stringify(
      locationResult
        .sort(
          (a, b) =>
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        )
        .filter(
          (value, index, self) =>
            index ===
            self.findIndex(
              (t) =>
                t.label === value.label &&
                t.country?.code?.toLocaleLowerCase() ===
                  value.country?.code?.toLocaleLowerCase()
            )
        )
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ),
      null,
      2
    ) + "\n"
  );
};

summarize();
