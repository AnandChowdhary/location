import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { listLocationCommits, loadHistoryEntries, readApiJsonAt } from "../src/git";

let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf-8" }).trim();

const commit = (message: string, files: Record<string, unknown>) => {
  for (const [name, contents] of Object.entries(files))
    writeFileSync(
      join(repo, name),
      typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`
    );
  git("add", ".");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};

const snapshot = (label: string, date: string, extra: object = {}) => ({
  date,
  coordinates: [52.09, 5.12],
  label,
  full_label: `${label}, somewhere`,
  timezone: { name: "Europe/Amsterdam" },
  country_code: "nl",
  country_emoji: "🇳🇱",
  ...extra,
});

describe("git history", () => {
  const hashes: Record<string, string> = {};

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "location-git-test-"));
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    hashes.utrecht = commit("📍🇳🇱 Utrecht", { "api.json": snapshot("Utrecht", "2026-01-01T08:00:00.000Z") });
    commit("docs: unrelated change", { "README.md": "hi\n" });
    commit("fix: hand edit of api.json", { "api.json": snapshot("Utrecht", "2026-01-01T09:00:00.000Z") });
    hashes.zurich = commit("📍🇨🇭 Zürich", {
      "api.json": snapshot("Zürich", "2026-01-05T08:00:00.000Z", {
        country_code: "ch",
        country_emoji: "🇨🇭",
        timezone: undefined,
      }),
    });
  });

  after(() => rmSync(repo, { recursive: true, force: true }));

  it("lists only 📍 commits that touch api.json, newest first", () => {
    assert.deepEqual(listLocationCommits(repo), [
      { hash: hashes.zurich, subject: "📍🇨🇭 Zürich" },
      { hash: hashes.utrecht, subject: "📍🇳🇱 Utrecht" },
    ]);
  });

  it("reads api.json at each commit, including non-ASCII labels", () => {
    const [zurich, utrecht] = readApiJsonAt([hashes.zurich, hashes.utrecht], repo);
    assert.equal(zurich.label, "Zürich");
    assert.equal(zurich.country_emoji, "🇨🇭");
    assert.equal(utrecht.date, "2026-01-01T08:00:00.000Z");
  });

  it("returns nothing for no hashes", () => {
    assert.deepEqual(readApiJsonAt([], repo), []);
  });

  it("fails clearly for a commit without api.json", () => {
    const tree = execFileSync("git", ["mktree"], { cwd: repo, input: "", encoding: "utf-8" }).trim();
    const empty = git("commit-tree", tree, "-m", "empty");
    assert.throws(() => readApiJsonAt([empty], repo), /Could not read api.json/);
  });

  it("builds history entries with commit hashes and timezone names", () => {
    assert.deepEqual(loadHistoryEntries(repo), [
      {
        label: "Zürich",
        coordinates: [52.09, 5.12],
        date: "2026-01-05T08:00:00.000Z",
        hash: hashes.zurich,
        country_code: "ch",
        timezone_name: "",
      },
      {
        label: "Utrecht",
        coordinates: [52.09, 5.12],
        date: "2026-01-01T08:00:00.000Z",
        hash: hashes.utrecht,
        country_code: "nl",
        timezone_name: "Europe/Amsterdam",
      },
    ]);
  });
});
