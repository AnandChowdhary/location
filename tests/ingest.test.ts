import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applySimilarLabel,
  dateFrom,
  getLabel,
  ingest,
  MAX_CLOCK_SKEW,
  parsePayload,
  round2,
  skipReasonBeforeGeocode,
} from "../src/ingest";
import type { ApiResult, OpenStreetMapGeocodeResponse, Overwrite } from "../src/types";

const fixture = <T>(file: string) =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", file), "utf-8")) as T;

const delhi = fixture<ApiResult>("api-delhi.json"); // dated 2026-11-07T08:00:34.900Z
const bengaluruGeocode = fixture<OpenStreetMapGeocodeResponse>("nominatim-bengaluru.json");
const overwrite: Overwrite = {
  similarLabels: { labels: { Karnataka: "Bengaluru", "Mandakini Enclave": "New Delhi" } },
  ignore: { labels: [] },
  layovers: { hashes: [] },
};
const NOW = new Date("2026-11-21T10:52:48.769Z");

describe("round2", () => {
  it("keeps two decimals", () => {
    assert.equal(round2(12.9585318), 12.96);
    assert.equal(round2(77.5928732), 77.59);
    assert.equal(round2(-0.004), -0);
  });
});

describe("parsePayload", () => {
  it("rounds coordinates and dates the update now by default", () => {
    assert.deepEqual(parsePayload({ lat: 12.9585318, lon: 77.5928732 }, NOW), {
      lat: 12.96,
      lon: 77.59,
      date: NOW,
    });
  });

  for (const [name, payload, message] of [
    ["a non-object", "12,77", /JSON object/],
    ["an array", [12, 77], /JSON object/],
    ["null", null, /JSON object/],
    ["a missing lat", { lon: 77 }, /numeric lat/],
    ["a string lon", { lat: 12, lon: "77" }, /numeric lon/],
    ["NaN", { lat: NaN, lon: 77 }, /numeric lat/],
    ["latitude out of range", { lat: 91, lon: 77 }, /Latitude/],
    ["longitude out of range", { lat: 12, lon: -181 }, /Longitude/],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.throws(() => parsePayload(payload, NOW), message);
    });
  }
});

describe("dateFrom", () => {
  it("uses now when date is absent or empty", () => {
    assert.equal(dateFrom({}, NOW), NOW);
    assert.equal(dateFrom({ date: "" }, NOW), NOW);
    assert.equal(dateFrom({ date: null }, NOW), NOW);
  });

  it("accepts ISO 8601 with an offset", () => {
    assert.equal(
      dateFrom({ date: "2026-11-18T12:00:00+05:30" }, NOW).toISOString(),
      "2026-11-18T06:30:00.000Z"
    );
  });

  it("allows a little clock drift but not future dates", () => {
    const drift = new Date(NOW.getTime() + MAX_CLOCK_SKEW - 1000).toISOString();
    assert.equal(dateFrom({ date: drift }, NOW).toISOString(), drift);
    assert.throws(() => dateFrom({ date: "2030-01-01T00:00:00Z" }, NOW), /future/);
  });

  it("rejects invalid and non-string dates", () => {
    assert.throws(() => dateFrom({ date: "nope" }, NOW), /not a valid date/);
    assert.throws(() => dateFrom({ date: 1763722368 }, NOW), /ISO 8601 string/);
  });
});

describe("getLabel", () => {
  it("picks the most specific place name", () => {
    assert.equal(getLabel(bengaluruGeocode.address, "India"), "Bengaluru");
    assert.equal(
      getLabel({ state: "Utrecht", municipality: "Utrecht", village: "De Meern" }, "Netherlands"),
      "De Meern"
    );
  });

  it("skips names without Latin letters", () => {
    assert.equal(getLabel({ state: "Kanto", city: "東京都" }, "Japan"), "Kanto");
  });

  it("falls back to the country", () => {
    assert.equal(getLabel({}, "India"), "India");
  });
});

describe("applySimilarLabel", () => {
  it("maps aliases and leaves other labels alone", () => {
    assert.equal(applySimilarLabel("Karnataka", overwrite), "Bengaluru");
    assert.equal(applySimilarLabel("Mysuru", overwrite), "Mysuru");
  });
});

describe("skipReasonBeforeGeocode", () => {
  const at = (iso: string, lat = 12.96, lon = 77.59) => ({ lat, lon, date: new Date(iso) });

  it("skips updates that are not newer than api.json", () => {
    assert.match(skipReasonBeforeGeocode(delhi, at(delhi.date))!, /not newer/);
    assert.match(skipReasonBeforeGeocode(delhi, at("2026-11-01T00:00:00Z"))!, /not newer/);
  });

  it("skips updates within 3 hours", () => {
    assert.match(skipReasonBeforeGeocode(delhi, at("2026-11-07T10:00:00Z"))!, /3 hours/);
  });

  it("skips unchanged rounded coordinates", () => {
    assert.match(
      skipReasonBeforeGeocode(delhi, at("2026-11-18T00:00:00Z", 28.53, 77.25))!,
      /unchanged/
    );
  });

  it("lets a real move through", () => {
    assert.equal(skipReasonBeforeGeocode(delhi, at("2026-11-18T06:30:00Z")), undefined);
  });
});

describe("ingest", () => {
  const geocodeWith = (response: OpenStreetMapGeocodeResponse) => {
    const calls: [number, number][] = [];
    const reverseGeocode = async (lat: number, lon: number) => {
      calls.push([lat, lon]);
      return response;
    };
    return { calls, reverseGeocode };
  };

  it("writes the same api.json the workflow wrote for Bengaluru", async () => {
    const { calls, reverseGeocode } = geocodeWith(bengaluruGeocode);
    const result = await ingest({
      payload: { lat: 12.9585318, lon: 77.5928732, date: "2026-11-18T06:30:00.000Z" },
      previous: delhi,
      overwrite,
      now: NOW,
      reverseGeocode,
    });
    assert.deepEqual(calls, [[12.96, 77.59]]);
    assert.ok(result.changed);
    assert.equal(result.message, "📍🇮🇳 Bengaluru");
    assert.deepEqual(result.data, {
      date: "2026-11-18T06:30:00.000Z",
      coordinates: [12.96, 77.59],
      label: "Bengaluru",
      full_label: bengaluruGeocode.display_name,
      timezone: {
        name: "Asia/Kolkata",
        countries: ["IN"],
        utcOffset: 330,
        utcOffsetStr: "+05:30",
        dstOffset: 330,
        dstOffsetStr: "+05:30",
        aliasOf: null,
      },
      country_code: "in",
      country_emoji: "🇮🇳",
    });
  });

  it("does not geocode when an update is skipped early", async () => {
    const { calls, reverseGeocode } = geocodeWith(bengaluruGeocode);
    const result = await ingest({
      payload: { lat: 12.96, lon: 77.59, date: "2026-11-07T09:00:00Z" },
      previous: delhi,
      overwrite,
      now: NOW,
      reverseGeocode,
    });
    assert.deepEqual(result, { changed: false, reason: "previous update is less than 3 hours old" });
    assert.equal(calls.length, 0);
  });

  it("skips when the aliased label is unchanged", async () => {
    const previous: ApiResult = { ...delhi, label: "Bengaluru", country_code: "in", coordinates: [12.97, 77.6] };
    const { reverseGeocode } = geocodeWith({
      display_name: "Somewhere, Karnataka, India",
      address: { state: "Karnataka", country_code: "in" },
    });
    const result = await ingest({ payload: { lat: 12.96, lon: 77.59 }, previous, overwrite, now: NOW, reverseGeocode });
    assert.deepEqual(result, { changed: false, reason: "location label is unchanged" });
  });

  it("fails when the geocoder returns no country", async () => {
    const { reverseGeocode } = geocodeWith({ display_name: "Ocean", address: {} });
    await assert.rejects(
      ingest({ payload: { lat: 0, lon: 0 }, previous: delhi, overwrite, now: NOW, reverseGeocode }),
      /country code/
    );
  });
});
