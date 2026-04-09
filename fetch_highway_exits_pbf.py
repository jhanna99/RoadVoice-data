#!/usr/bin/env python3
"""
fetch_highway_exits_pbf.py

Parses local OSM PBF files (downloaded from Geofabrik) to extract highway
exit data and writes RoadVoice-compatible JSON files to the highways/ folder.

SETUP:
    1. pip install osmium
    2. Download PBF files for the states you want from Geofabrik, e.g.:
         https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf
       Place them in the same folder as this script.
    3. Edit highways_config.py to add/remove states and highways.
    4. python fetch_highway_exits_pbf.py

PERFORMANCE vs. original two-pass approach:
    - Pass 1 now collects ALL motorway_junction node IDs (cheap — no location
      resolution needed, just tag checks on nodes).
    - Pass 2 scans ways to find which junction nodes are on target highways,
      using NodeLocationsForWays to resolve coordinates in the same pass.
      No third pass needed.
    - Parallel processing: all states run concurrently using multiprocessing,
      one worker per state, up to the number of CPU cores.

OSM Data © OpenStreetMap contributors (ODbL)
"""

import json
import re
import osmium
import osmium.index
from pathlib import Path
from collections import defaultdict
from multiprocessing import Pool, cpu_count

from highways_config import STATES

OUTPUT_DIR = Path("highways")


# ---------------------------------------------------------------------------
# PBF file discovery
# ---------------------------------------------------------------------------

def find_pbf(state_name):
    """
    Find the newest PBF file for the given state in the current directory.
    Prefers dated files (massachusetts-260408.osm.pbf) over -latest variants.
    Returns a Path or None.
    """
    dated_pattern  = re.compile(
        rf"{re.escape(state_name)}-(\d{{6}})\.osm\.pbf", re.IGNORECASE
    )
    latest_pattern = re.compile(
        rf"{re.escape(state_name)}-latest\.osm\.pbf", re.IGNORECASE
    )
    best_dated, best_date, latest = None, -1, None

    for p in Path(".").glob(f"{state_name}*.osm.pbf"):
        m = dated_pattern.match(p.name)
        if m:
            date_int = int(m.group(1))
            if date_int > best_date:
                best_date  = date_int
                best_dated = p
        elif latest_pattern.match(p.name):
            latest = p

    return best_dated or latest


# ---------------------------------------------------------------------------
# OSM helpers
# ---------------------------------------------------------------------------

def ref_token_set(ref_str):
    """Split semicolon-delimited OSM ref into a set of tokens."""
    return {t.strip() for t in ref_str.split(";") if t.strip()}


# ---------------------------------------------------------------------------
# Pass 1: collect all motorway_junction node IDs and their tags
#
# Nodes appear before ways in PBF files, so we first harvest all junction
# nodes (IDs + tags + coordinates). This pass is very fast because we only
# store data for motorway_junction nodes, which are a tiny fraction of all
# nodes in the file.
# ---------------------------------------------------------------------------

class JunctionCollector(osmium.SimpleHandler):
    """Pass 1: collect every motorway_junction node in the file."""

    def __init__(self):
        super().__init__()
        # node_id -> dict with lat, lon, exitRef, name, destination
        self.junctions = {}

    def node(self, n):
        if n.tags.get("highway") != "motorway_junction":
            return
        if not n.location.valid():
            return

        tags        = n.tags
        exit_ref    = tags.get("ref", "")
        name        = tags.get("name", "")

        destination = tags.get("destination", tags.get("exit_to", ""))
        if destination:
            destination = ", ".join(
                d.strip() for d in destination.split(";") if d.strip()
            )

        if name:
            display_name = name
        elif destination:
            display_name = destination.split(",")[0].strip()
        else:
            display_name = f"Exit {exit_ref}" if exit_ref else "Exit"

        self.junctions[n.id] = {
            "lat":         round(n.location.lat, 6),
            "lon":         round(n.location.lon, 6),
            "exitRef":     exit_ref,
            "name":        display_name,
            "destination": destination,
            "osmId":       n.id,
        }


# ---------------------------------------------------------------------------
# Pass 2: scan ways to match target highways, then look up junction records
#
# NodeLocationsForWays gives us node coordinates during way processing, but
# we only need them as a fallback here — Pass 1 already captured them.
# The real work is matching ways to highway configs and recording which
# junction nodes belong to which highway.
# ---------------------------------------------------------------------------

class WayMatcher(osmium.SimpleHandler):
    """Pass 2: match target highway ways and collect their junction nodes."""

    def __init__(self, highways, junctions):
        super().__init__()
        self.highways  = highways
        self.junctions = junctions          # from Pass 1
        self.exits     = defaultdict(dict)  # hwy key -> {osmId: record}
        self.way_count = 0

    def way(self, w):
        hw  = w.tags.get("highway", "")
        ref = w.tags.get("ref", "")
        if not ref:
            return

        way_tokens = ref_token_set(ref)

        for hwy in self.highways:
            if hw not in hwy["highway_tags"]:
                continue
            if not (way_tokens & hwy["ref_tokens"]):
                continue

            self.way_count += 1
            key = hwy["key"]
            for node_ref in w.nodes:
                nid = node_ref.ref
                if nid in self.junctions and nid not in self.exits[key]:
                    self.exits[key][nid] = self.junctions[nid]


# ---------------------------------------------------------------------------
# Sorting and output
# ---------------------------------------------------------------------------

def sort_exits(exits):
    def sort_key(e):
        ref    = e.get("exitRef", "")
        digits = "".join(c for c in ref if c.isdigit())
        alpha  = "".join(c for c in ref if c.isalpha())
        return (int(digits) if digits else 9999, alpha, e["lat"])
    return sorted(exits, key=sort_key)


# ---------------------------------------------------------------------------
# Per-state worker (runs in its own process)
# ---------------------------------------------------------------------------

def process_state(state_cfg):
    """
    Process one state's PBF file and write JSON output files.
    Returns a result dict for summary reporting.
    """
    pbf_state  = state_cfg["pbf_state"]
    highways   = state_cfg["highways"]
    output_dir = Path("highways")
    output_dir.mkdir(exist_ok=True)

    result = {"state": pbf_state, "skipped": False, "outputs": [], "error": None}

    pbf_path = find_pbf(pbf_state)
    if pbf_path is None:
        result["skipped"] = True
        result["pbf_url"] = state_cfg.get("pbf_url", "")
        return result

    try:
        pbf_str = str(pbf_path)

        # --- Pass 1: collect all junction nodes (fast — tag filter only) ---
        collector = JunctionCollector()
        collector.apply_file(pbf_str, locations=True)

        if not collector.junctions:
            result["error"] = "No motorway_junction nodes found"
            return result

        # --- Pass 2: match ways and assign junctions to highways ---
        matcher = WayMatcher(highways, collector.junctions)
        matcher.apply_file(pbf_str, locations=False)

        # --- Write output JSON files ---
        for hwy in highways:
            exits    = sort_exits(list(matcher.exits.get(hwy["key"], {}).values()))
            out_path = output_dir / f"{hwy['key']}.json"

            with open(out_path, "w", encoding="utf-8") as f:
                json.dump({
                    "key":             hwy["key"],
                    "displayName":     hwy["displayName"],
                    "category":        "highway_exits",
                    "state":           hwy["state"],
                    "useLocationName": True,
                    "locations":       exits,
                }, f, indent=2, ensure_ascii=False)

            result["outputs"].append((hwy["displayName"], len(exits), out_path.name))

    except Exception as e:
        result["error"] = str(e)

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    available, missing = [], []
    for s in STATES:
        if find_pbf(s["pbf_state"]):
            available.append(s)
        else:
            missing.append(s)

    if not available:
        print("No PBF files found. Download state PBFs from Geofabrik and re-run.")
        return

    workers = min(cpu_count(), len(available))
    print(f"Processing {len(available)} state(s) using {workers} parallel worker(s)...")
    if missing:
        print(f"Skipping {len(missing)} state(s) — no PBF on disk.\n")

    with Pool(processes=workers) as pool:
        results = pool.map(process_state, available)

    total_files = 0
    print()
    for r in results:
        label = r["state"].upper()
        if r.get("skipped"):
            print(f"  [{label}] SKIPPED — {r.get('pbf_url','')}")
        elif r.get("error"):
            print(f"  [{label}] ERROR: {r['error']}")
        else:
            print(f"  [{label}]")
            for display, count, fname in r["outputs"]:
                print(f"    {display}: {count} exits  ->  {fname}")
                total_files += 1

    if missing:
        print(f"\nSkipped states (download PBF to include):")
        for s in missing:
            print(f"  {s.get('pbf_url','')}")

    print(f"\nDone. {total_files} JSON file(s) written to {OUTPUT_DIR.resolve()}")
    print("Data © OpenStreetMap contributors (ODbL) — see OSM_ATTRIBUTION.md")


if __name__ == "__main__":
    main()
