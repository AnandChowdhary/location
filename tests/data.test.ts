import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getCountry } from "countries-and-timezones";
import { flag } from "country-emoji";
import { listLocationCommits } from "../src/git";
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
    assert.equal(new Set(overwrite.layovers.hashes).size, overwrite.layovers.hashes.length);
  });

  it("only lists layovers that are 📍 commits in this repo", {
    todo: "24 hashes point at commits lost when history was rewritten",
  }, (t) => {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: root,
      encoding: "utf-8",
    }).trim();
    if (shallow === "true") return t.skip("needs full git history (fetch-depth: 0)");
    const known = new Set(listLocationCommits(root).map((commit) => commit.hash));
    const missing = overwrite.layovers.hashes.filter((hash) => !known.has(hash));
    assert.deepEqual(missing, [], "layover hashes not found among 📍 commits");
  });
});
