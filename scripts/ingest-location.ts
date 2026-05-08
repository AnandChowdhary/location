import { appendFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { getCountry, getTimezone } from "countries-and-timezones";
import { flag } from "country-emoji";
import type { ApiResult, OpenStreetMapGeocodeResponse } from "..";

// tz-lookup is CommonJS; require keeps swc-node from looking for a non-existent default export.
// @ts-ignore
const tzLookup = require("tz-lookup") as (lat: number, lon: number) => string;

const MIN_TIME = 3 * 60 * 60 * 1000; // 3 hours, matching the Worker
interface IncomingPayload {
  lat?: unknown;
  lon?: unknown;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const setOutput = (name: string, value: string | number | boolean) => {
  const output = String(value);
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`${name}=${output}`);
    return;
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${name}<<__LOCATION_OUTPUT__\n${output}\n__LOCATION_OUTPUT__\n`
  );
};

const skip = (reason: string) => {
  console.log(`Skipping location update: ${reason}`);
  setOutput("changed", "false");
  setOutput("reason", reason);
};

const readPayload = async (): Promise<IncomingPayload> => {
  const file = process.argv[2];
  const raw = file ? await readFile(file, "utf-8") : process.env.LOCATION_PAYLOAD;
  if (!raw?.trim()) throw new Error("Missing location payload JSON");

  const parsed = JSON.parse(raw) as IncomingPayload;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Location payload must be a JSON object");
  }
  return parsed;
};

const numberFrom = (payload: IncomingPayload, key: keyof IncomingPayload) => {
  const value = payload[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Location payload must include numeric ${key}`);
  }
  return value;
};

const dateFrom = () => new Date();

const getLabel = (
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
    if (option && /[A-z\u00C0-\u00ff]+/g.test(option)) label = option;
  });
  return label;
};

const reverseGeocode = async (lat: number, lon: number) => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept-Language": "en-US,en;q=0.5",
          "User-Agent": "github@anandchowdhary.com location-shortcut-ingest",
        },
      });
      if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);
      return (await response.json()) as OpenStreetMapGeocodeResponse;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  throw lastError;
};

const main = async () => {
  const payload = await readPayload();
  const latRaw = numberFrom(payload, "lat");
  const lonRaw = numberFrom(payload, "lon");
  const timestamp = dateFrom();

  if (latRaw < -90 || latRaw > 90) throw new Error("Latitude is out of range");
  if (lonRaw < -180 || lonRaw > 180) throw new Error("Longitude is out of range");

  const previous = JSON.parse(await readFile("api.json", "utf-8")) as ApiResult;
  const lat = round2(latRaw);
  const lon = round2(lonRaw);

  if (timestamp.getTime() <= new Date(previous.date).getTime()) {
    skip("timestamp is not newer than api.json");
    return;
  }

  if (timestamp.getTime() - new Date(previous.date).getTime() < MIN_TIME) {
    skip("previous update is less than 3 hours old");
    return;
  }

  if (previous.coordinates[0] === lat && previous.coordinates[1] === lon) {
    skip("rounded coordinates are unchanged");
    return;
  }

  const geocode = await reverseGeocode(lat, lon);
  const countryCode = geocode.address.country_code?.toLowerCase();
  if (!countryCode) throw new Error("Reverse geocode did not return a country code");

  const country = getCountry(countryCode.toUpperCase());
  if (!country) throw new Error(`Country not found for ${countryCode}`);

  const timezone = getTimezone(tzLookup(lat, lon));
  if (!timezone) throw new Error(`Timezone not found for ${lat}, ${lon}`);

  const countryEmoji = flag(country.id) ?? "🌍";
  const label = getLabel(geocode.address, country.name);

  if (previous.label === label && previous.country_code === countryCode) {
    skip("location label is unchanged");
    return;
  }

  const data: ApiResult = {
    date: timestamp.toISOString(),
    coordinates: [lat, lon],
    label,
    full_label: geocode.display_name,
    timezone,
    country_code: countryCode,
    country_emoji: countryEmoji,
  };

  await writeFile("api.json", `${JSON.stringify(data, null, 2)}\n`);

  setOutput("changed", "true");
  setOutput("date", data.date);
  setOutput("label", data.label);
  setOutput("message", `📍${data.country_emoji} ${data.label}`);
  console.log(`Prepared ${data.country_emoji} ${data.label} at ${data.date}`);
};

main().catch((error) => {
  console.error(error);
  setOutput("changed", "false");
  setOutput("reason", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
