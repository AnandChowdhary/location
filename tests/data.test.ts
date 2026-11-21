import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getCountry } from "countries-and-timezones";
import { flag } from "country-emoji";
import { loadHistoryEntries } from "../src/git";
import type { ApiResult, Overwrite } from "../src/types";

const root = join(__dirname, "..");
const read = <T>(file: string) => JSON.parse(readFileSync(join(root, file), "utf-8")) as T;

describe("api.json", () => {
  const api = read<ApiResult>("api.json");

  it("has a valid date that is not in the future", () => {
    const time = new Date(api.date).getTime();
    assert.ok(Number.isFinite(time));
    assert.equal(new Date(api.date).toISOString(), api.date);
    assert.ok(time <= Date.now() + 5 * 60 * 1000);
  });

  it("stores coordinates with at most two decimals", () => {
    for (const value of api.coordinates)
      assert.equal(Math.round(value * 100) / 100, value);
  });

  it("has a known country, matching flag and a timezone", () => {
    const country = getCountry(api.country_code.toUpperCase());
    assert.ok(country, `unknown country ${api.country_code}`);
    assert.equal(api.country_emoji, flag(country.id));
    assert.ok(api.timezone?.name);
    assert.ok(api.label.trim());
  });
});

describe("overwrite.json", () => {
  const overwrite = read<Overwrite>("overwrite.json");

  it("has no alias that maps a label to itself", () => {
    for (const [from, to] of Object.entries(overwrite.similarLabels.labels))
      assert.notEqual(from, to);
  });

  it("has no duplicate ignores or layovers", () => {
    assert.equal(new Set(overwrite.ignore.labels).size, overwrite.ignore.labels.length);
    const keys = overwrite.layovers.entries.map((l) => `${l.date} ${l.label}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("matches every layover to exactly one 📍 snapshot", (t) => {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: root,
      encoding: "utf-8",
    }).trim();
    if (shallow === "true") return t.skip("needs full git history (fetch-depth: 0)");
    const snapshots = loadHistoryEntries(root);
    const unmatched = overwrite.layovers.entries.filter(
      (layover) =>
        snapshots.filter((s) => s.date === layover.date && s.label === layover.label)
          .length !== 1
    );
    assert.deepEqual(unmatched, [], "layovers must name one snapshot's date and raw label");
  });
});
