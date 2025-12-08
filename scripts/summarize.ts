import { getCountry } from "countries-and-timezones";
import { simpleGit } from "simple-git";
import { ApiResult } from "..";

// @ts-ignore
import { readFile, writeFile } from "fs/promises";

const git = simpleGit({});
type Location = {
  label: string;
  coordinates: [number, number];
  date: string;
  hash: string;
  country_code: string;
  timezone_name: string;
};

export const summarize = async () => {
  const overwrite = JSON.parse(await readFile("overwrite.json", "utf-8")) as {
    similarLabels: { labels: Record<string, string> };
    ignore: { labels: string[] };
    layovers: { hashes: string[] };
  };
  const log = await git.log({ file: "api.json" });
  const commits = log.all.filter((commit) => commit.message.startsWith("📍"));
  const data: Location[] = [];
  for (const commit of commits) {
    const show = JSON.parse(
      await git.show(`${commit.hash}:api.json`)
    ) as ApiResult;
    const item: Location = {
      label: show.label,
      coordinates: [show.coordinates[0], show.coordinates[1]],
      date: show.date,
      hash: commit.hash,
      country_code: show.country_code,
      timezone_name: show.timezone?.name ?? "",
    };
    data.push(item);
  }
  await writeFile(
    "history-full.json",
    JSON.stringify(
      data.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
      null,
      2
    ) + "\n"
  );

  const locationResult: Location[] = [];
  const getOverwrittenLabel = (label: string): string => {
    return overwrite.similarLabels.labels[label] ?? label;
  };
  const safePush = (item: Location) => {
    Object.entries(overwrite.similarLabels.labels).forEach(([key, value]) => {
      if (item.label === key) item.label = value;
    });
    if (overwrite.ignore.labels.includes(item.label)) return;
    if (!overwrite.layovers.hashes.includes(item.hash))
      locationResult.push(item);
  };
  let skipped: (Location & { duration: number })[] = [];
  data
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((location, index, array) => {
      const previous = array[index - 1];
      if (previous) {
        const a = previous.coordinates[0] - location.coordinates[0];
        const b = previous.coordinates[1] - location.coordinates[1];
        const c = Math.sqrt(a * a + b * b);
        const duration = array[index + 1]
          ? new Date(array[index + 1].date).getTime() -
            new Date(location.date).getTime()
          : 0;
        if (
          c > 2 ||
          (location.country_code &&
            previous.country_code &&
            location.country_code !== previous.country_code) ||
          location.timezone_name !== previous.timezone_name
        ) {
          if (skipped.length) {
            const items: Record<string, number> = {};
            skipped.forEach((item) => {
              const overwrittenLabel = getOverwrittenLabel(item.label);
              items[overwrittenLabel] =
                (items[overwrittenLabel] || 0) + item.duration;
            });
            const skippedSelected = skipped
              .filter((i) => i.duration > 43200000) // 12 hours
              .sort((a, b) => b.duration - a.duration)[0];
            if (
              skippedSelected &&
              locationResult[locationResult.length - 1]?.label !==
                getOverwrittenLabel(skippedSelected.label)
            ) {
              const { duration: _, ...item } = skippedSelected;
              safePush(item);
            }
            if (
              (!skippedSelected ||
                skippedSelected.country_code !== location.country_code) &&
              locationResult[locationResult.length - 1]?.label !==
                getOverwrittenLabel(location.label)
            )
              safePush(location);
          } else {
            if (
              locationResult[locationResult.length - 1]?.label !==
              getOverwrittenLabel(location.label)
            )
              safePush(location);
          }
          skipped = [];
        } else {
          skipped.push({
            ...location,
            duration,
          });
        }
      } else {
        if (
          locationResult[locationResult.length - 1]?.label !==
          getOverwrittenLabel(location.label)
        )
          safePush(location);
        skipped = [];
      }
    });
  if (skipped.length) {
    const items: Record<string, number> = {};
    skipped[skipped.length - 1].duration =
      new Date().getTime() -
      new Date(skipped[skipped.length - 1].date).getTime();
    skipped.forEach((item) => {
      const overwrittenLabel = getOverwrittenLabel(item.label);
      items[overwrittenLabel] = (items[overwrittenLabel] || 0) + item.duration;
    });
    const { duration: _, ...skippedSelected } = skipped.sort(
      (a, b) => b.duration - a.duration
    )[0];
    if (
      locationResult[locationResult.length - 1]?.label !==
      getOverwrittenLabel(skippedSelected.label)
    )
      safePush(skippedSelected);
  }
  await writeFile(
    "history.json",
    JSON.stringify(
      locationResult.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
      null,
      2
    ) + "\n"
  );
  await writeFile(
    "history-unique.json",
    JSON.stringify(
      locationResult
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter(
          (value, index, self) =>
            index ===
            self.findIndex(
              (t) =>
                t.label === value.label && t.country_code === value.country_code
            )
        )
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
      null,
      2
    ) + "\n"
  );
  await writeFile(
    "history-countries.json",
    JSON.stringify(
      locationResult
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter(
          (value, index, self) =>
            index ===
            self.findIndex((t) => t.country_code === value.country_code)
        )
        .map((data) => {
          const country = getCountry(data.country_code.toUpperCase());
          return {
            ...data,
            label: country?.name ?? data.country_code ?? data.label,
          };
        })
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
      null,
      2
    ) + "\n"
  );

  // Create a new file showing all country visits (including repeated visits)
  await writeFile(
    "history-countries-full.json",
    JSON.stringify(
      locationResult
        .map((data) => {
          const country = getCountry(data.country_code.toUpperCase());
          return {
            ...data,
            label: country?.name ?? data.country_code ?? data.label,
          };
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter((value, index, array) => {
          // Keep the first entry
          if (index === 0) return true;
          // Keep if the previous entry was a different country
          return array[index - 1].country_code !== value.country_code;
        })
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
      null,
      2
    ) + "\n"
  );
};

summarize();
