import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildHistory, historyFiles } from "../src/history";
import type { HistoryEntry, Overwrite } from "../src/types";

const golden = join(__dirname, "fixtures", "golden");
const readGolden = (file: string) => readFileSync(join(golden, file), "utf-8");

const noOverwrite = (): Overwrite => ({
  similarLabels: { labels: {} },
  ignore: { labels: [] },
  layovers: { entries: [] },
});

let counter = 0;
/** A snapshot `hours` after 2026-01-01T00:00Z. */
const entry = (
  label: string,
  hours: number,
  [lat, lon]: [number, number],
  country_code = "nl",
  timezone_name = "Europe/Amsterdam"
): HistoryEntry => ({
  label,
  coordinates: [lat, lon],
  date: new Date(Date.UTC(2026, 0, 1) + hours * 3_600_000).toISOString(),
  hash: `hash-${++counter}`,
  country_code,
  timezone_name,
});

const UTRECHT: [number, number] = [52.09, 5.12];
const DE_MEERN: [number, number] = [52.08, 5.03];
const PARIS: [number, number] = [48.86, 2.35];
const DELHI: [number, number] = [28.53, 77.25];
const BENGALURU: [number, number] = [12.96, 77.59];

const labels = (entries: HistoryEntry[]) => entries.map((e) => e.label);
const farFuture = new Date(Date.UTC(2026, 5, 1));

describe("buildHistory: golden output", () => {
  // Input and expected output were produced by the pre-refactor summarize
  // script on the real history, with the clock pinned to NOW. Any change to
  // these files is a change in what the website shows.
  const NOW = new Date("2026-11-21T12:00:00.000Z");
  const input = JSON.parse(readGolden("history-full.json")) as HistoryEntry[];
  const overwrite = JSON.parse(readGolden("overwrite.json")) as Overwrite;
  const files = historyFiles(buildHistory(input, overwrite, NOW));

  for (const file of [
    "history-full.json",
    "history.json",
    "history-unique.json",
    "history-countries.json",
    "history-countries-full.json",
  ]) {
    it(`reproduces ${file}`, () => {
      assert.equal(files[file], readGolden(file));
    });
  }

  it("does not mutate its input", () => {
    const before = JSON.stringify(input);
    buildHistory(input, overwrite, NOW);
    assert.equal(JSON.stringify(input), before);
  });

  it("does not depend on input order when timestamps are unique", () => {
    // Snapshots with the same timestamp keep their input (git log) order,
    // so only compare inputs without such ties.
    const unique = input.filter(
      (e, _, all) => all.filter((o) => o.date === e.date).length === 1
    );
    const forward = historyFiles(buildHistory(unique, overwrite, NOW));
    const reversed = historyFiles(buildHistory([...unique].reverse(), overwrite, NOW));
    assert.deepEqual(reversed, forward);
  });
});

describe("buildHistory: rules", () => {
  it("returns empty files for no snapshots", () => {
    const history = buildHistory([], noOverwrite(), farFuture);
    assert.deepEqual(history.history, []);
    assert.deepEqual(history.countries, []);
  });

  it("starts a new stay when the country changes", () => {
    const history = buildHistory(
      [
        entry("Utrecht", 0, UTRECHT),
        entry("Paris", 48, PARIS, "fr", "Europe/Paris"),
        entry("Utrecht", 96, UTRECHT),
      ],
      noOverwrite(),
      farFuture
    );
    assert.deepEqual(labels(history.history), ["Utrecht", "Paris", "Utrecht"]);
    assert.deepEqual(labels(history.unique), ["Paris", "Utrecht"]);
    assert.deepEqual(labels(history.countries), ["France", "Netherlands"]);
    assert.deepEqual(labels(history.countriesFull), [
      "Netherlands",
      "France",
      "Netherlands",
    ]);
  });

  it("adds a nearby cluster's longest 12h+ stay after its first snapshot", () => {
    const history = buildHistory(
      [
        entry("Paris", 0, PARIS, "fr", "Europe/Paris"),
        entry("De Meern", 24, DE_MEERN), // starts the cluster
        entry("De Meern", 30, DE_MEERN), // 6h: too short
        entry("Utrecht", 36, UTRECHT), // 60h: longest
        entry("De Meern", 96, DE_MEERN), // 24h
        entry("Paris", 120, PARIS, "fr", "Europe/Paris"),
      ],
      noOverwrite(),
      farFuture
    );
    assert.deepEqual(labels(history.history).reverse(), [
      "Paris",
      "De Meern",
      "Utrecht",
      "Paris",
    ]);
  });

  it("merges back-to-back snapshots of the same place into one stay", () => {
    // The backfill case: a dated Bengaluru entry followed by a same-place
    // update a few days later shows as one stay from the earlier date.
    const delhi = entry("New Delhi", 0, DELHI, "in", "Asia/Kolkata");
    const arrived = entry("Bengaluru", 24 * 11, BENGALURU, "in", "Asia/Kolkata");
    const later = entry("Bengaluru", 24 * 14, BENGALURU, "in", "Asia/Kolkata");
    const history = buildHistory([delhi, arrived, later], noOverwrite(), farFuture);
    assert.deepEqual(labels(history.history), ["Bengaluru", "New Delhi"]);
    assert.equal(history.history[0].date, arrived.date);
  });

  it("uses `now` to close the current stay", () => {
    const snapshots = [
      entry("Paris", 0, PARIS, "fr", "Europe/Paris"),
      entry("Utrecht", 24, UTRECHT), // starts the cluster
      entry("De Meern", 30, DE_MEERN), // 10h
      entry("Utrecht", 40, UTRECHT), // current stay, open-ended
    ];
    // 5h into the current stay, De Meern's 10h is the longest; later it isn't.
    const early = buildHistory(snapshots, noOverwrite(), new Date(Date.UTC(2026, 0, 2, 21)));
    const late = buildHistory(snapshots, noOverwrite(), farFuture);
    assert.equal(early.history[0].label, "De Meern");
    assert.equal(late.history[0].label, "Utrecht");
  });

  it("applies similarLabels in order, so aliases can chain", () => {
    const overwrite = noOverwrite();
    overwrite.similarLabels.labels = { Delhi: "New Delhi", "New Delhi": "Dilli" };
    const history = buildHistory(
      [
        entry("Delhi", 0, DELHI, "in", "Asia/Kolkata"),
        entry("Paris", 48, PARIS, "fr", "Europe/Paris"),
      ],
      overwrite,
      farFuture
    );
    assert.deepEqual(labels(history.history), ["Paris", "Dilli"]);
    assert.equal(history.full[1].label, "Delhi", "history-full keeps raw labels");
  });

  it("drops ignored labels after aliasing", () => {
    const overwrite = noOverwrite();
    overwrite.similarLabels.labels = { "Noord-Holland": "Schiphol" };
    overwrite.ignore.labels = ["Schiphol"];
    const history = buildHistory(
      [
        entry("Paris", 0, PARIS, "fr", "Europe/Paris"),
        entry("Noord-Holland", 48, [52.31, 4.76]),
        entry("Delhi", 96, DELHI, "in", "Asia/Kolkata"),
      ],
      overwrite,
      farFuture
    );
    assert.deepEqual(labels(history.history), ["Delhi", "Paris"]);
  });

  it("drops layovers by snapshot date and raw label", () => {
    const layover = entry("Dubai", 48, [25.25, 55.36], "ae", "Asia/Dubai");
    const overwrite = noOverwrite();
    overwrite.layovers.entries = [{ date: layover.date, label: "Dubai" }];
    const history = buildHistory(
      [
        entry("Utrecht", 0, UTRECHT),
        { ...layover, hash: "rewritten-hash" }, // hashes don't matter
        entry("Delhi", 60, DELHI, "in", "Asia/Kolkata"),
      ],
      overwrite,
      farFuture
    );
    assert.deepEqual(labels(history.history), ["Delhi", "Utrecht"]);
    assert.equal(history.full.length, 3, "history-full keeps layovers");
  });

  it("matches layovers before aliasing, and only on both date and label", () => {
    const glitch = entry("Mandakini Enclave", 48, DELHI, "in", "Asia/Kolkata");
    const sameTime = entry("Abu Dhabi", 96, [24.43, 54.65], "ae", "Asia/Dubai");
    const overwrite = noOverwrite();
    overwrite.similarLabels.labels = { "Mandakini Enclave": "New Delhi" };
    overwrite.layovers.entries = [
      { date: glitch.date, label: "Mandakini Enclave" },
      { date: sameTime.date, label: "Dubai" }, // wrong label: not dropped
    ];
    const history = buildHistory(
      [entry("Utrecht", 0, UTRECHT), glitch, sameTime],
      overwrite,
      farFuture
    );
    assert.deepEqual(labels(history.history), ["Abu Dhabi", "Utrecht"]);
  });
});
