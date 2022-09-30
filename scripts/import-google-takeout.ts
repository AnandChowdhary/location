import { execSync } from "child_process";
import {
  getCountry as getCountryDetails,
  getTimezone,
} from "countries-and-timezones";
import { flag } from "country-emoji";
import * as dayjs from "dayjs";
import { readFile, writeFile } from "fs/promises";
import readdirp from "readdirp";
import { ApiResult } from "..";

const COMMIT_END_DATE = "2022-09-01";

const getCountry = (label: string): string => {
  if (label.startsWith("日本") || label.includes("Nishi-Ku")) return "JP";
  if (label === "United States" || label === "USA") return "US";
  if (label.includes("灣")) return "TW";
  if (label.includes("إمارة")) return "AE";
  if (
    label === "India" ||
    label === "भारत" ||
    label === "Inde" ||
    label === "Ấn Độ" ||
    label.includes("Kashmir") ||
    label.includes("Haryana")
  )
    return "IN";
  if (label === "Nederland" || label === "Netherlands") return "NL";
  if (label === "France") return "FR";
  if (label === "Türkiye" || label === "Turkey") return "TR";
  if (label === "Deutschland" || label === "Duitsland") return "DE";
  if (label === "Česko") return "CZ";
  if (label === "Schweiz" || label === "Suisse") return "CH";
  if (label === "Belgique" || label === "Belgium" || label === "België")
    return "BE";
  if (label === "141400") return "RU";
  if (label === "Italia") return "IT";
  if (label === "UK") return "GB";
  if (label === "Malaysia") return "MY";
  throw new Error(`Unknown country: ${label}`);
};

export const takeout = async () => {
  // const places: {
  //   date: string;
  //   latitude: number;
  //   longitude: number;
  //   label: string;
  //   countryCode: string;
  // }[] = [];
  // for await (const { fullPath } of readdirp(
  //   "/Users/anandchowdhary/Downloads/Takeout/Location History/Semantic Location History"
  // )) {
  //   if (!fullPath.endsWith(".json")) continue;
  //   const { timelineObjects } = JSON.parse(await readFile(fullPath, "utf8"));
  //   for (const item of timelineObjects) {
  //     if (!("placeVisit" in item)) continue;

  //     const result: {
  //       location: {
  //         latitudeE7: number;
  //         longitudeE7: number;
  //         placeId: string;
  //         address: string;
  //         name: string;
  //       };
  //       duration: {
  //         startTimestamp: string;
  //         endTimestamp: string;
  //       };
  //       otherCandidateLocations: {
  //         latitudeE7: number;
  //         longitudeE7: number;
  //         placeId: string;
  //         address: string;
  //         name: string;
  //       }[];
  //     } = item.placeVisit;
  //     if (
  //       "location" in result &&
  //       (typeof result.location.address === "string" ||
  //         (result.otherCandidateLocations &&
  //           result.otherCandidateLocations.find(
  //             (item) => typeof item.address === "string"
  //           )))
  //     ) {
  //       if (typeof result.location.address !== "string")
  //         result.location.address =
  //           result.otherCandidateLocations.find(
  //             (item) => typeof item.address === "string"
  //           )?.address ?? "";
  //       const previous = places[places.length - 1];
  //       let label =
  //         result.location.address
  //           .replace("、", ", ")
  //           .split(", ")
  //           .reverse()[1] ?? "";
  //       const country = result.location.address.split(", ").reverse()[0];
  //       if (!country) continue;
  //       const countryCode = getCountry(country);
  //       if (!label) continue;
  //       label = label.replace(/[0-9]/g, "").trim();
  //       if (label[2] === " ") label = label.split(" ")[1];

  //       const latitude =
  //         Math.round((result.location.latitudeE7 / 1e7) * 100) / 100;
  //       const longitude =
  //         Math.round((result.location.longitudeE7 / 1e7) * 100) / 100;
  //       const date = new Date(result.duration.startTimestamp).toISOString();

  //       if (previous) {
  //         if (
  //           Math.round(previous.latitude * 10) / 10 ===
  //             Math.round(latitude * 10) / 10 &&
  //           Math.round(previous.longitude * 10) / 10 ===
  //             Math.round(longitude * 10) / 10
  //         )
  //           continue;
  //         if (previous.label === label) continue;
  //       }

  //       places.push({ label, latitude, longitude, date, countryCode });
  //     }
  //   }
  // }
  // writeFile(
  //   "places.json",
  //   JSON.stringify(
  //     places.sort(
  //       (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  //     ),
  //     null,
  //     2
  //   )
  // );

  const places = (
    JSON.parse(await readFile("places.json", "utf8")) as {
      date: string;
      latitude: number;
      longitude: number;
      label: string;
      countryCode: string;
    }[]
  ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let previous: typeof places[0] | undefined = undefined;
  for (const place of places.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )) {
    if (new Date(place.date).getTime() > new Date(COMMIT_END_DATE).getTime())
      continue;

    if (previous?.label === place.label) continue;

    const country = getCountryDetails(place.countryCode);
    if (!country) throw new Error("Country not found");
    const emoji = flag(country.id);
    if (!emoji) throw new Error("Emoji not found");
    if (!place.label.trim()) continue;

    const timezone =
      country.timezones.length === 1
        ? getTimezone(country.timezones[0])
        : undefined;

    const data: ApiResult = {
      updatedAt: place.date,
      approximateCoordinates: [place.latitude, place.longitude],
      label: place.label,
      timezone,
      country: {
        code: place.countryCode,
        name: country.name,
        timezones: country.timezones,
      },
    };

    await writeFile("api.json", JSON.stringify(data, null, 2) + "\n");
    const date = dayjs(place.date).format("ddd MMM DD HH:mm:ss YYYY ZZ");
    console.log(
      execSync(
        `git add . && GIT_AUTHOR_DATE="${date}" GIT_COMMITTER_DATE="${date}" git commit -m "📍${emoji} ${place.label}"`,
        { stdio: "inherit" }
      )
    );
    console.log("Added", place.label);
    previous = place;
  }
};

takeout();
