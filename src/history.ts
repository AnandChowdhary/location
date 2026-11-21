import { getCountry } from "countries-and-timezones";
import type { HistoryEntry, Overwrite } from "./types";

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

export interface History {
  /** Every 📍 snapshot, newest first (history-full.json). */
  full: HistoryEntry[];
  /** Normalized stays, newest first (history.json). */
  history: HistoryEntry[];
  /** First visit to each label + country, newest first (history-unique.json). */
  unique: HistoryEntry[];
  /** First visit to each country, newest first (history-countries.json). */
  countries: HistoryEntry[];
  /** Every change of country, newest first (history-countries-full.json). */
  countriesFull: HistoryEntry[];
}

const time = (entry: { date: string }) => new Date(entry.date).getTime();
const newestFirst = (a: { date: string }, b: { date: string }) =>
  time(b) - time(a);
const oldestFirst = (a: { date: string }, b: { date: string }) =>
  time(a) - time(b);

const withCountryName = (entry: HistoryEntry): HistoryEntry => {
  const country = getCountry(entry.country_code.toUpperCase());
  return {
    ...entry,
    label: country?.name ?? entry.country_code ?? entry.label,
  };
};

/**
 * Turns raw 📍 snapshots into the history files.
 *
 * Consecutive snapshots close to each other (same country and timezone,
 * within 2° of each other) form a cluster; only its longest stay of 12+ hours
 * is kept, so short hops around a city don't show up as separate visits.
 * `now` closes the duration of the current stay.
 */
export const buildHistory = (
  entries: HistoryEntry[],
  overwrite: Overwrite,
  now: Date
): History => {
  const clone = (entry: HistoryEntry): HistoryEntry => ({
    ...entry,
    coordinates: [entry.coordinates[0], entry.coordinates[1]],
  });
  const full = entries.map(clone).sort(newestFirst);
  const data = entries.map(clone).sort(oldestFirst);

  const locationResult: HistoryEntry[] = [];
  const getOverwrittenLabel = (label: string): string =>
    overwrite.similarLabels.labels[label] ?? label;
  const lastLabel = () => locationResult[locationResult.length - 1]?.label;
  const layovers = new Set(
    overwrite.layovers.entries.map((layover) => `${layover.date}\u0000${layover.label}`)
  );
  const isLayover = (item: HistoryEntry) => layovers.has(`${item.date}\u0000${item.label}`);
  const safePush = (item: HistoryEntry) => {
    // Checked before aliasing: layovers name the snapshot's raw label.
    const layover = isLayover(item);
    // Applied in order, so one alias can feed into a later one.
    Object.entries(overwrite.similarLabels.labels).forEach(([key, value]) => {
      if (item.label === key) item.label = value;
    });
    if (overwrite.ignore.labels.includes(item.label)) return;
    if (!layover) locationResult.push(item);
  };

  let skipped: (HistoryEntry & { duration: number })[] = [];
  data.forEach((location, index, array) => {
    const previous = array[index - 1];
    if (!previous) {
      if (lastLabel() !== getOverwrittenLabel(location.label))
        safePush(location);
      skipped = [];
      return;
    }

    const a = previous.coordinates[0] - location.coordinates[0];
    const b = previous.coordinates[1] - location.coordinates[1];
    const distance = Math.sqrt(a * a + b * b);
    const duration = array[index + 1]
      ? time(array[index + 1]) - time(location)
      : 0;
    const startsNewCluster =
      distance > 2 ||
      (location.country_code &&
        previous.country_code &&
        location.country_code !== previous.country_code) ||
      location.timezone_name !== previous.timezone_name;

    if (!startsNewCluster) {
      skipped.push({ ...location, duration });
      return;
    }

    if (skipped.length) {
      const skippedSelected = skipped
        .filter((item) => item.duration > TWELVE_HOURS)
        .sort((x, y) => y.duration - x.duration)[0];
      if (
        skippedSelected &&
        lastLabel() !== getOverwrittenLabel(skippedSelected.label)
      ) {
        const { duration: _, ...item } = skippedSelected;
        safePush(item);
      }
      if (
        (!skippedSelected ||
          skippedSelected.country_code !== location.country_code) &&
        lastLabel() !== getOverwrittenLabel(location.label)
      )
        safePush(location);
    } else if (lastLabel() !== getOverwrittenLabel(location.label)) {
      safePush(location);
    }
    skipped = [];
  });

  if (skipped.length) {
    skipped[skipped.length - 1].duration =
      now.getTime() - time(skipped[skipped.length - 1]);
    const { duration: _, ...skippedSelected } = skipped.sort(
      (x, y) => y.duration - x.duration
    )[0];
    if (lastLabel() !== getOverwrittenLabel(skippedSelected.label))
      safePush(skippedSelected);
  }

  const history = [...locationResult].sort(newestFirst);
  // Derived from `history` so entries with equal dates keep the same order.
  const chronological = [...history].sort(oldestFirst);

  return {
    full,
    history,
    unique: chronological
      .filter(
        (value, index, self) =>
          index ===
          self.findIndex(
            (t) =>
              t.label === value.label && t.country_code === value.country_code
          )
      )
      .sort(newestFirst),
    countries: chronological
      .filter(
        (value, index, self) =>
          index ===
          self.findIndex((t) => t.country_code === value.country_code)
      )
      .map(withCountryName)
      .sort(newestFirst),
    countriesFull: chronological
      .map(withCountryName)
      .filter(
        (value, index, array) =>
          index === 0 || array[index - 1].country_code !== value.country_code
      )
      .sort(newestFirst),
  };
};

/** File name → contents, as written to the repo root and GitHub Pages. */
export const historyFiles = (history: History): Record<string, string> => {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  return {
    "history-full.json": json(history.full),
    "history.json": json(history.history),
    "history-unique.json": json(history.unique),
    "history-countries.json": json(history.countries),
    "history-countries-full.json": json(history.countriesFull),
  };
};
