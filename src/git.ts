import { execFileSync } from "child_process";
import type { ApiResult, HistoryEntry } from "./types";

export interface LocationCommit {
  hash: string;
  subject: string;
}

/** Every 📍 commit that touched api.json, newest first. */
export const listLocationCommits = (cwd = process.cwd()): LocationCommit[] =>
  execFileSync("git", ["log", "--format=%H%x1f%s", "--", "api.json"], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split("\x1f");
      return { hash, subject };
    })
    .filter((commit) => commit.subject.startsWith("📍"));

/**
 * Reads api.json at every commit with one `git cat-file --batch` process
 * instead of one `git show` per commit.
 */
export const readApiJsonAt = (
  hashes: string[],
  cwd = process.cwd()
): ApiResult[] => {
  if (!hashes.length) return [];
  const output = execFileSync("git", ["cat-file", "--batch"], {
    cwd,
    input: hashes.map((hash) => `${hash}:api.json\n`).join(""),
    maxBuffer: 256 * 1024 * 1024,
  });
  const decoder = new TextDecoder();
  const results: ApiResult[] = [];
  let offset = 0;
  for (const hash of hashes) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = decoder.decode(output.subarray(offset, headerEnd));
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size))
      throw new Error(`Could not read api.json at ${hash}: ${header}`);
    const start = headerEnd + 1;
    results.push(
      JSON.parse(decoder.decode(output.subarray(start, start + size)))
    );
    offset = start + size + 1;
  }
  return results;
};

/** All 📍 snapshots as history entries, newest first (git log order). */
export const loadHistoryEntries = (cwd = process.cwd()): HistoryEntry[] => {
  const commits = listLocationCommits(cwd);
  const snapshots = readApiJsonAt(
    commits.map((commit) => commit.hash),
    cwd
  );
  return commits.map((commit, index) => {
    const show = snapshots[index];
    return {
      label: show.label,
      coordinates: [show.coordinates[0], show.coordinates[1]],
      date: show.date,
      hash: commit.hash,
      country_code: show.country_code,
      timezone_name: show.timezone?.name ?? "",
    };
  });
};
