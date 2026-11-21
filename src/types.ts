import type { Timezone } from "countries-and-timezones";

/** Shape of api.json: the current location, one snapshot per 📍 commit. */
export interface ApiResult {
  date: string;
  coordinates: [number, number];
  label: string;
  full_label: string;
  timezone: Timezone;
  country_code: string;
  country_emoji: string;
}

export interface OpenStreetMapGeocodeResponse {
  name?: string;
  display_name: string;
  address: Record<string, string | undefined> & {
    country?: string;
    country_code?: string;
  };
}

/**
 * A 📍 snapshot to leave out, by its own date and raw (un-aliased) label.
 * Unlike a commit hash, this survives rebases, squashes and re-imports.
 */
export interface Layover {
  date: string;
  label: string;
}

/** overwrite.json: manual corrections applied when building the history. */
export interface Overwrite {
  similarLabels: { labels: Record<string, string> };
  ignore: { labels: string[] };
  layovers: { entries: Layover[] };
}

/** One entry in the history files. */
export interface HistoryEntry {
  label: string;
  coordinates: [number, number];
  date: string;
  hash: string;
  country_code: string;
  timezone_name: string;
}
