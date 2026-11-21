import { appendFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { ingest } from "../src/ingest";
import type { ApiResult, OpenStreetMapGeocodeResponse, Overwrite } from "../src/types";

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

const readPayload = async (): Promise<unknown> => {
  const file = process.argv[2];
  const raw = file ? await readFile(file, "utf-8") : process.env.LOCATION_PAYLOAD;
  if (!raw?.trim()) throw new Error("Missing location payload JSON");
  return JSON.parse(raw);
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
  const result = await ingest({
    payload: await readPayload(),
    previous: JSON.parse(await readFile("api.json", "utf-8")) as ApiResult,
    overwrite: JSON.parse(await readFile("overwrite.json", "utf-8")) as Overwrite,
    now: new Date(),
    reverseGeocode,
  });

  if (!result.changed) {
    console.log(`Skipping location update: ${result.reason}`);
    setOutput("changed", "false");
    setOutput("reason", result.reason);
    return;
  }

  await writeFile("api.json", `${JSON.stringify(result.data, null, 2)}\n`);
  setOutput("changed", "true");
  setOutput("date", result.data.date);
  setOutput("label", result.data.label);
  setOutput("message", result.message);
  console.log(`Prepared ${result.data.country_emoji} ${result.data.label} at ${result.data.date}`);
};

main().catch((error) => {
  console.error(error);
  setOutput("changed", "false");
  setOutput("reason", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
