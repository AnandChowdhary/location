import { readFile, writeFile } from "fs/promises";
import { simpleGit } from "simple-git";
import { ApiResult } from "..";

const git = simpleGit({});
type Location = Omit<ApiResult, "country" | "timezone"> & {
  country: Partial<ApiResult["country"]>;
  timezone: Partial<ApiResult["timezone"]>;
  hash: string;
};

export const summarize = async () => {
  const overwrite = JSON.parse(await readFile("overwrite.json", "utf-8")) as {
    similarLabels: { labels: Record<string, string> };
    layovers: { hashes: string[] };
  };
  const log = await git.log({ file: "api.json" });
  const commits = log.all.filter((commit) => commit.message.startsWith("📍"));
  const data: Location[] = [];
  for (const commit of commits) {
    const show = JSON.parse(
      await git.show(`${commit.hash}:api.json`)
    ) as Location;
    delete show.country.timezones;
    delete show.timezone?.utcOffsetStr;
    delete show.timezone?.dstOffsetStr;
    delete show.timezone?.aliasOf;
    delete show.timezone?.countries;
    if (show.country.code) show.country.code = show.country.code.toLowerCase();
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

  const locationResult: Location[] = [];
  const safePush = (item: Location) => {
    Object.entries(overwrite.similarLabels.labels).forEach(([key, value]) => {
      if (item.label === key) item.label = value;
    });
    if (!overwrite.layovers.hashes.includes(item.hash))
      locationResult.push(item);
  };
  let skipped: (Location & { duration: number })[] = [];
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
        const duration = array[index + 1]
          ? new Date(array[index + 1].updatedAt).getTime() -
            new Date(location.updatedAt).getTime()
          : 0;
        if (
          c > 2 ||
          (location.country?.code &&
            previous.country?.code &&
            location.country?.code !== previous.country?.code) ||
          location.timezone?.name !== previous.timezone?.name
        ) {
          if (skipped.length) {
            const items: Record<string, number> = {};
            skipped.forEach((item) => {
              items[item.label] = (items[item.label] || 0) + item.duration;
            });
            const skippedSelected = skipped
              .filter((i) => i.duration > 43200000) // 12 hours
              .sort((a, b) => b.duration - a.duration)[0];
            if (
              skippedSelected &&
              locationResult[locationResult.length - 1]?.label !==
                skippedSelected.label
            ) {
              const { duration: _, ...item } = skippedSelected;
              safePush(item);
            }
            if (
              (!skippedSelected ||
                skippedSelected.country.code !== location.country.code) &&
              locationResult[locationResult.length - 1]?.label !==
                location.label
            )
              safePush(location);
          } else {
            if (
              locationResult[locationResult.length - 1]?.label !==
              location.label
            )
              safePush(location);
          }
          skipped = [];
        } else {
          console.log("skipping", location.updatedAt, location.label);
          skipped.push({
            ...location,
            duration,
          });
        }
      } else {
        if (locationResult[locationResult.length - 1]?.label !== location.label)
          safePush(location);
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
    const { duration: _, ...skippedSelected } = skipped.sort(
      (a, b) => b.duration - a.duration
    )[0];
    safePush(skippedSelected);
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
                t.country?.code === value.country?.code
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
  await writeFile(
    "history-countries.json",
    JSON.stringify(
      locationResult
        .sort(
          (a, b) =>
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        )
        .filter(
          (value, index, self) =>
            index ===
            self.findIndex((t) => t.country?.code === value.country?.code)
        )
        .map((data) => ({
          ...data,
          label: data.country?.name ?? data.country?.code ?? data.label,
        }))
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
