import {
  getCountry,
  getTimezone,
  type Timezone,
} from "countries-and-timezones";
import { flag } from "country-emoji";
import * as tzLookup from "tz-lookup";

// @ts-ignore
import { readFile, writeFile } from "fs/promises";

export interface OpenStreetMapGeocodeResponse {
  name: string;
  display_name: string;
  address: Record<string, string> & {
    country: string;
    country_code: string;
  };
}

// Haversine formula to calculate distance between two geographic coordinates
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

type TimelineItem = {
  endTime: string;
  startTime: string;
  visit?: {
    hierarchyLevel: string;
    topCandidate: {
      probability: string;
      semanticType: string;
      placeID: string;
      placeLocation: string;
    };
    probability: string;
  };
  activity?: {
    end: string;
    topCandidate: { type: string; probability: string };
    distanceMeters: string;
    start: string;
  };
  timelinePath?: Array<{
    point: string;
    durationMinutesOffsetFromStartTime: string;
  }>;
  timelineMemory?: {
    destinations: Array<{
      identifier: string;
    }>;
    distanceFromOriginKms: string;
  };
};

const importGoogleTimeline = async () => {
  const result: {
    date: Date;
    coordinates: [number, number];
    label: string;
    timezone?: Timezone;
    country_code: string;
    country_emoji: string;
    full_label: string;
  }[] = [];

  const data = JSON.parse(
    await readFile(
      "/Users/anandchowdhary/Downloads/location-history.json",
      "utf-8"
    )
  ) as TimelineItem[];

  for (const item of data) {
    let coordinates: [number, number] | undefined;

    const start = new Date(item.startTime);
    if ("visit" in item && item.visit?.topCandidate) {
      const placeLocation = item.visit.topCandidate.placeLocation;
      if (placeLocation.startsWith("geo:")) {
        const coords = placeLocation.replace("geo:", "").split(",");
        if (coords.length === 2) {
          coordinates = [Number(coords[0]), Number(coords[1])];
        } else {
          console.log("Invalid placeLocation format:", placeLocation);
        }
      } else {
        console.log("Unexpected placeLocation format:", placeLocation);
      }
    } else if ("activity" in item && item.activity?.end) {
      const endLocation = item.activity.end;
      if (endLocation.startsWith("geo:")) {
        const coords = endLocation.replace("geo:", "").split(",");
        if (coords.length === 2) {
          coordinates = [Number(coords[0]), Number(coords[1])];
        } else {
          console.log("Invalid end location format:", endLocation);
        }
      } else {
        console.log("Unexpected end location format:", endLocation);
      }
    } else if ("timelinePath" in item && item.timelinePath?.[0]) {
      const point = item.timelinePath[0].point;
      if (point.startsWith("geo:")) {
        const coords = point.replace("geo:", "").split(",");
        if (coords.length === 2) {
          coordinates = [Number(coords[0]), Number(coords[1])];
        } else {
          console.log("Invalid point format:", point);
        }
      } else {
        console.log("Unexpected point format:", point);
      }
    } else if (
      "timelineMemory" in item &&
      item.timelineMemory?.destinations?.[0]
    ) {
      // For timelineMemory items, we don't have direct coordinates
      // These are place identifiers that would need to be resolved to coordinates
      continue;
    }

    if (!coordinates) {
      console.log("No coordinates found for", JSON.stringify(item));
      continue;
    }

    if (isNaN(coordinates[0]) || isNaN(coordinates[1])) {
      console.log(
        "NaN coordinates detected:",
        coordinates,
        "for item:",
        JSON.stringify(item)
      );
      continue;
    }

    const add = async () => {
      // For privacy reasons, round coordinates to two decimal places
      const lat = Math.round(coordinates[0] * 100) / 100;
      const lon = Math.round(coordinates[1] * 100) / 100;

      const geocode = (await (
        await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
          {
            headers: {
              "Accept-Language": "en-US,en;q=0.5",
              "User-Agent": "github@anandchowdhary.com",
            },
          }
        )
      ).json()) as OpenStreetMapGeocodeResponse;

      const country = getCountry(geocode.address.country_code.toUpperCase());
      if (!country) {
        console.log("No country found for", geocode.address.country_code);
        return;
      }

      const emoji = flag(country.id);

      let label = country.name;

      [
        geocode.address.state,
        geocode.address.town,
        geocode.address.city,
      ].forEach((option) => {
        // Check if label is Latin-1 for btoa
        if (option && /[A-z\u00C0-\u00ff]+/g.test(option)) label = option;
      });

      const countryCode =
        geocode.address.country_code || country.id.toLowerCase();

      result.push({
        date: start,
        coordinates: [lat, lon],
        label,
        full_label: geocode.display_name,
        timezone: getTimezone(tzLookup(lat, lon)) ?? undefined,
        country_code: countryCode,
        country_emoji: emoji ?? "",
      });
      console.log(result[result.length - 1].label);
      await writeFile("result.json", JSON.stringify(result, null, 2));

      await new Promise((resolve) => setTimeout(resolve, 1000));
    };

    const previous = result[result.length - 1];
    if (!previous) {
      await add();
      continue;
    }

    // If it's less than 1 hour, ignore
    if (start.getTime() - previous.date.getTime() < 1000 * 60 * 60) continue;

    // Calculate distance in meters using Haversine formula
    const distance = calculateDistance(
      previous.coordinates[0], // lat1
      previous.coordinates[1], // lon1
      coordinates[0], // lat2
      coordinates[1] // lon2
    );

    // Only add if distance is more than 25 km
    if (distance < 25000) continue;

    await add();
  }

  console.log(result.length, result.slice(-100));
};

importGoogleTimeline();
