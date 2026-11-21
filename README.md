# 📍 Anand's location

This repository tracks my (approximate) location. An Apple Shortcut sends my coordinates to a GitHub Actions workflow, which stores them in `api.json` (rounded to ~1 km), commits them, and publishes the history to GitHub Pages.

![City](https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=city&query=%24.label&url=https%3A%2F%2Fanandchowdhary.github.io%2Flocation%2Fapi.json)
![Country](https://img.shields.io/badge/dynamic/json?style=for-the-badge&color=green&label=country&query=%24.country_emoji&url=https%3A%2F%2Fanandchowdhary.github.io%2Flocation%2Fapi.json)
![Time zone](https://img.shields.io/badge/dynamic/json?style=for-the-badge&color=brightgreen&label=timezone&query=%24.timezone.name&url=https%3A%2F%2Fanandchowdhary.github.io%2Flocation%2Fapi.json)

**Location history on git:** https://github.com/AnandChowdhary/location/commits/main/api.json

| API                         | Endpoint                                                              |
| --------------------------- | --------------------------------------------------------------------- |
| Current location            | https://anandchowdhary.github.io/location/api.json                    |
| Full (raw) location history | https://anandchowdhary.github.io/location/history-full.json           |
| Normalized location history | https://anandchowdhary.github.io/location/history.json                |
| Unique locations            | https://anandchowdhary.github.io/location/history-unique.json         |
| Unique countries            | https://anandchowdhary.github.io/location/history-countries.json      |
| Full country history        | https://anandchowdhary.github.io/location/history-countries-full.json |

## 📲 Apple Shortcuts ingest

The `Ingest Location` workflow accepts location updates from Apple Shortcuts via GitHub's API. The payload is intentionally tiny: just rounded latitude and longitude. GitHub stores workflow inputs/dispatch payloads, so round before sending if you don't want raw precise coordinates in the dispatch metadata.

Payload shape:

```json
{
  "lat": 52.08,
  "lon": 5.06
}
```

To backfill a missed update, add an optional ISO 8601 `date` for when you arrived, e.g. `"date": "2026-11-18T12:00:00+05:30"`. It can't be in the future, and it must be later than the date in the current `api.json`. Without it, the update is dated now.

Preferred endpoint for Shortcuts:

```bash
curl -X POST https://api.github.com/repos/AnandChowdhary/location/dispatches \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{
    "event_type": "location-update",
    "client_payload": {
      "lat": 52.08,
      "lon": 5.06
    }
  }'
```

Manual debug endpoint:

```bash
curl -X POST https://api.github.com/repos/AnandChowdhary/location/actions/workflows/ingest-location.yml/dispatches \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{
    "ref": "main",
    "inputs": {
      "payload": "{\"lat\":52.08,\"lon\":5.06}"
    }
  }'
```

Use a fine-grained token scoped only to this repository. For `repository_dispatch`, grant Contents read/write. For `workflow_dispatch`, grant Actions write.

## 🛠️ Development

```bash
npm ci
npm test            # history, ingest, git and data tests
npm run typecheck
npm run summarize   # rebuild history*.json locally from the git history
```

- `src/`: the logic: `history.ts` (normalizing snapshots into stays), `ingest.ts` (payload → `api.json`), `git.ts` (reading 📍 commits).
- `scripts/`: thin entry points used by the workflows, plus one-off backfill tools (`timeline`, `commits`).
- `overwrite.json`: manual corrections: label aliases, ignored labels and layovers.
- The golden test in `tests/history.test.ts` pins the output for the real history; if a change to the algorithm is intentional, regenerate `tests/fixtures/golden/`.

## 📄 License

[MIT](./LICENSE) © [Anand Chowdhary](https://anandchowdhary.com)
