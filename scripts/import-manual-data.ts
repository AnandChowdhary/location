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
    date: "2023-01-08",
    label: "Abu Dhabi",
    country: "AE",
    latitude: 24.43,
    longitude: 54.64,
  },
  {
    date: "2023-02-02",
    label: "Abu Dhabi",
    country: "AE",
    latitude: 24.43,
    longitude: 54.64,
  },
  {
    date: "2023-02-03",
    label: "Abu Dhabi",
    country: "AE",
    latitude: 24.43,
    longitude: 54.64,
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
