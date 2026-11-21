import { getCountry, getTimezone } from "countries-and-timezones";
import { flag } from "country-emoji";
import type { ApiResult, OpenStreetMapGeocodeResponse, Overwrite } from "./types";

// tz-lookup is CommonJS; require keeps swc-node from looking for a non-existent default export.
// @ts-ignore
const tzLookup = require("tz-lookup") as (lat: number, lon: number) => string;

/** Minimum gap between two updates. */
export const MIN_TIME = 3 * 60 * 60 * 1000;
/** How far in the future a payload `date` may be, for clock drift. */
export const MAX_CLOCK_SKEW = 5 * 60 * 1000;

export interface IncomingPayload {
  lat?: unknown;
  lon?: unknown;
  date?: unknown;
}

export interface ParsedPayload {
  lat: number;
  lon: number;
  date: Date;
}

/** For privacy, only two decimals (~1 km) are ever stored. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

const numberFrom = (payload: IncomingPayload, key: "lat" | "lon") => {
  const value = payload[key];
  if (typeof value !== "number" || Number.isNaN(value))
    throw new Error(`Location payload must include numeric ${key}`);
  return value;
};

/**
 * Optional ISO 8601 `date` says when you arrived, so a missed update can be
 * backfilled. Without it, the update is dated `now`.
 */
export const dateFrom = (payload: IncomingPayload, now: Date) => {
  if (payload.date === undefined || payload.date === null || payload.date === "")
    return now;
  if (typeof payload.date !== "string")
    throw new Error("Location payload date must be an ISO 8601 string");
  const date = new Date(payload.date);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Location payload date is not a valid date: ${payload.date}`);
  if (date.getTime() > now.getTime() + MAX_CLOCK_SKEW)
    throw new Error("Location payload date is in the future");
  return date;
};

export const parsePayload = (raw: unknown, now: Date): ParsedPayload => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Location payload must be a JSON object");
  const payload = raw as IncomingPayload;
  const lat = numberFrom(payload, "lat");
  const lon = numberFrom(payload, "lon");
  if (lat < -90 || lat > 90) throw new Error("Latitude is out of range");
  if (lon < -180 || lon > 180) throw new Error("Longitude is out of range");
  return { lat: round2(lat), lon: round2(lon), date: dateFrom(payload, now) };
};

/** Most specific Latin-script place name in the address, else the country. */
export const getLabel = (
  address: OpenStreetMapGeocodeResponse["address"],
  countryName: string
) => {
  let label = countryName;
  [
    address.state,
    address.county,
    address.municipality,
    address.city,
    address.town,
    address.village,
    address.hamlet,
  ].forEach((option) => {
    if (option && /[A-zÀ-ÿ]+/g.test(option)) label = option;
  });
  return label;
};

/** Same aliases as the history, so api.json says "Paris", not a suburb. */
export const applySimilarLabel = (label: string, overwrite: Overwrite) =>
  overwrite.similarLabels.labels[label] ?? label;

/** Why an update should be skipped before geocoding, if at all. */
export const skipReasonBeforeGeocode = (
  previous: ApiResult,
  { lat, lon, date }: ParsedPayload
): string | undefined => {
  const previousTime = new Date(previous.date).getTime();
  if (date.getTime() <= previousTime) return "timestamp is not newer than api.json";
  if (date.getTime() - previousTime < MIN_TIME)
    return "previous update is less than 3 hours old";
  if (previous.coordinates[0] === lat && previous.coordinates[1] === lon)
    return "rounded coordinates are unchanged";
  return undefined;
};

export type IngestResult =
  | { changed: true; data: ApiResult; message: string }
  | { changed: false; reason: string };

export interface IngestOptions {
  payload: unknown;
  previous: ApiResult;
  overwrite: Overwrite;
  now: Date;
  reverseGeocode: (lat: number, lon: number) => Promise<OpenStreetMapGeocodeResponse>;
}

/** Decides whether a payload becomes the new api.json, and what it says. */
export const ingest = async ({
  payload,
  previous,
  overwrite,
  now,
  reverseGeocode,
}: IngestOptions): Promise<IngestResult> => {
  const parsed = parsePayload(payload, now);
  const reason = skipReasonBeforeGeocode(previous, parsed);
  if (reason) return { changed: false, reason };

  const { lat, lon, date } = parsed;
  const geocode = await reverseGeocode(lat, lon);
  const countryCode = geocode.address.country_code?.toLowerCase();
  if (!countryCode) throw new Error("Reverse geocode did not return a country code");

  const country = getCountry(countryCode.toUpperCase());
  if (!country) throw new Error(`Country not found for ${countryCode}`);

  const timezone = getTimezone(tzLookup(lat, lon));
  if (!timezone) throw new Error(`Timezone not found for ${lat}, ${lon}`);

  const label = applySimilarLabel(getLabel(geocode.address, country.name), overwrite);
  if (previous.label === label && previous.country_code === countryCode)
    return { changed: false, reason: "location label is unchanged" };

  const data: ApiResult = {
    date: date.toISOString(),
    coordinates: [lat, lon],
    label,
    full_label: geocode.display_name,
    timezone,
    country_code: countryCode,
    country_emoji: flag(country.id) ?? "🌍",
  };
  return { changed: true, data, message: `📍${data.country_emoji} ${data.label}` };
};
