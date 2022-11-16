import { execSync } from "child_process";
import {
  getCountry as getCountryDetails,
  getTimezone,
} from "countries-and-timezones";
import { flag } from "country-emoji";
import * as dayjs from "dayjs";
import { writeFile } from "fs/promises";
import { ApiResult } from "..";

const data = [
  {
    date: "2011-05-26",
    country: "IN",
    label: "New Delhi",
    latitude: 28.53,
    longitude: 77.24,
  },
  {
    date: "2011-05-27",
    country: "PH",
    label: "Manila",
    latitude: 14.59,
    longitude: 120.99,
  },
  {
    date: "2011-06-15",
    country: "TH",
    label: "Pattaya",
    latitude: 12.93,
    longitude: 100.88,
  },
  {
    date: "2011-06-19",
    country: "TH",
    label: "Bangkok",
    latitude: 13.73,
    longitude: 100.47,
  },
  {
    date: "2011-06-21",
    country: "IN",
    label: "New Delhi",
    latitude: 28.53,
    longitude: 77.24,
  },
];

export const manual = async () => {
  for (const item of data) {
    const country = getCountryDetails(item.country);
    if (!country) throw new Error("Country not found");
    const emoji = flag(country.id);
    if (!emoji) throw new Error("Emoji not found");

    const timezone =
      country.timezones.length === 1
        ? getTimezone(country.timezones[0])
        : undefined;

    const data: ApiResult = {
      updatedAt: item.date,
      approximateCoordinates: [item.latitude, item.longitude],
      label: item.label,
      timezone,
      country: {
        code: item.country,
        name: country.name,
        timezones: country.timezones,
      },
    };

    await writeFile("api.json", JSON.stringify(data, null, 2) + "\n");
    const date = dayjs(item.date).format("ddd MMM DD HH:mm:ss YYYY ZZ");
    console.log(
      execSync(
        `git add . && GIT_AUTHOR_DATE="${date}" GIT_COMMITTER_DATE="${date}" git commit -m "📍${emoji} ${item.label}"`,
        { stdio: "inherit" }
      )
    );
    console.log("Added", item.label);
  }
};

manual();
