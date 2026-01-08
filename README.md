# RoadVoice Data

POI (Point of Interest) data for the RoadVoice app, processed from [AllThePlaces](https://alltheplaces.xyz/).

## Structure

```
manifest.json       # Brand metadata with checksums for update detection
brands/
  starbucks.json    # Per-brand location data
  mcdonalds.json
  ...
```

## Manifest Format

```json
{
  "version": 1,
  "generated": "2026-01-08T03:23:45.123Z",
  "atpBuildDate": "2026-01-05",
  "brands": {
    "starbucks": {
      "displayName": "Starbucks",
      "category": "coffee",
      "locationCount": 15760,
      "fileSize": 1720358,
      "checksum": "abc123..."
    }
  }
}
```

## Brand File Format

```json
{
  "key": "starbucks",
  "displayName": "Starbucks",
  "category": "coffee",
  "useLocationName": false,
  "locations": [
    {
      "name": "Starbucks",
      "lat": 47.6097,
      "lon": -122.3331,
      "city": "Seattle",
      "state": "WA",
      "address": "1912 Pike Pl"
    }
  ]
}
```

## Usage

The RoadVoice app fetches brand data on-demand from this repository. Updates are detected by comparing checksums in the manifest - no version numbers needed.

## Data Source

Location data is sourced from [AllThePlaces](https://alltheplaces.xyz/), which scrapes publicly available location data from brand websites. The data is licensed under CC-0 (public domain).

## Updates

This repository is updated periodically when new AllThePlaces builds are available (roughly weekly).
