import { Octokit } from "@octokit/core";
import { verify } from "@tsndr/cloudflare-worker-jwt";
import type { Timezone } from "countries-and-timezones";
import { getCountry, getTimezone } from "countries-and-timezones";
import { flag } from "country-emoji";
import tzLookup from "tz-lookup";

export interface Env {
  GITHUB_TOKEN: string;
  IFTTT_WEBHOOK_LOCATION_KEY: string;
  JWT_SECRET: string;
}

export interface ApiResult {
  updatedAt: string;
  approximateCoordinates: [number, number];
  label: string;
  timezone?: Timezone;
  country: {
    code: string;
    name: string;
    timezones: string[];
  };
}

export interface OwnTracksRequestBody {
  cog: number;
  batt: number;
  lon: number;
  acc: number;
  vel: number;
  vac: number;
  bs: number;
  lat: number;
  topic: string;
  t: string;
  conn: string;
  tst: number;
  alt: number;
}

const MIN_TIME = 10800000; // 3 hours

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.GITHUB_TOKEN)
      throw new Error("GITHUB_TOKEN environment variable is required");

    const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
    let data: ApiResult | undefined = undefined;

    try {
      const searchParams = new URL(request.url).searchParams;
      try {
        const isValid = await verify(
          searchParams.get("token") ?? "",
          env.JWT_SECRET
        );
        if (!isValid) return new Response("Invalid token", { status: 400 });
      } catch (error) {
        return new Response("Invalid token", { status: 400 });
      }

      const CHECK_DISABLED = searchParams.has("skip_check");

      // Ensure that the current location is not the same as the previous
      const previousLocation = await (
        await fetch("https://anandchowdhary.github.io/location/api.json")
      ).json<ApiResult>();
      if (
        Date.now() - new Date(previousLocation.updatedAt).getTime() <
          MIN_TIME &&
        !CHECK_DISABLED
      )
        return new Response("Skipping update because was updated recently");

      let _lat = 0;
      let _lon = 0;
      try {
        const result = await request.json<OwnTracksRequestBody>();
        _lat = result.lat;
        _lon = result.lon;
      } catch (error) {
        return new Response("Invalid request body", { status: 400 });
      }
      // For privacy reasons, I only store the latitude and longitude up to two decimal places
      const lat = Math.round(_lat * 100) / 100;
      const lon = Math.round(_lon * 100) / 100;

      if (
        previousLocation.approximateCoordinates[0] === lat &&
        previousLocation.approximateCoordinates[1] === lon &&
        !CHECK_DISABLED
      )
        return new Response("Skipping update because coordinates is similar");

      // Use OpenStreetMap's reverse geocoding API to get the location name
      const geocode = await (
        await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
          { headers: { "User-Agent": "github@anandchowdhary.com" } }
        )
      ).json<{
        name: string;
        display_name: string;
        address: Record<string, string> & {
          country: string;
          country_code: string;
        };
      }>();
      const country = getCountry(geocode.address.country_code.toUpperCase());
      if (!country)
        return new Response("Skipping update because country not found", {
          status: 500,
        });

      const emoji = flag(country.id);

      data = {
        updatedAt: new Date().toISOString(),
        approximateCoordinates: [lat, lon],
        label:
          geocode.address.village ??
          geocode.address.town ??
          geocode.address.city ??
          geocode.address.suburb ??
          geocode.address.county ??
          geocode.address.state ??
          country.name,
        timezone: getTimezone(tzLookup(lat, lon)) ?? undefined,
        country: {
          code: geocode.address.country_code,
          name: country.name,
          timezones: country.timezones,
        },
      };
      const message = `📍${emoji} ${data.label}`;

      if (data.label === previousLocation.label && !CHECK_DISABLED)
        return new Response(
          "Skipping update because location label is the same"
        );

      const { data: currentFileData } = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: "AnandChowdhary",
          repo: "location",
          path: "api.json",
        }
      );
      if (!("sha" in currentFileData))
        return new Response("Skipping update because previous SHA not found");

      if ("content" in currentFileData) {
        const previousApiResult = JSON.parse(
          atob(currentFileData.content)
        ) as ApiResult;
        if (previousApiResult.label === data.label && !CHECK_DISABLED)
          return new Response(
            "Skipping update because location label is the same"
          );
        if (
          Date.now() - new Date(previousApiResult.updatedAt).getTime() <
            MIN_TIME &&
          !CHECK_DISABLED
        )
          return new Response("Skipping update because was updated recently");
      }

      await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
        owner: "AnandChowdhary",
        repo: "location",
        path: "api.json",
        message,
        committer: {
          name: "Finding Anand",
          email: "bot@anandchowdhary.com",
        },
        content: btoa(JSON.stringify(data, null, 2) + "\n"),
        sha: currentFileData.sha,
      });

      await fetch(
        `https://maker.ifttt.com/trigger/location_changed/with/key/${env.IFTTT_WEBHOOK_LOCATION_KEY}`,
        {
          method: "POST",
          body: JSON.stringify({ value1: message }),
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      // Create a comment on issue #1
      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: "AnandChowdhary",
          repo: "location",
          issue_number: 1,
          body: String(error) + "\n\n" + JSON.stringify(data, null, 2),
        }
      );
    }

    return new Response("OK", { status: 201 });
  },
};
