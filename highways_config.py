"""
highways_config.py

Defines which highway exits to extract, organized by state.
Each state entry specifies:
  pbf_state   - the filename prefix used by Geofabrik
                e.g. "massachusetts" matches massachusetts-260408.osm.pbf
  pbf_url     - Geofabrik download URL for the PBF file (for reference/download hints)
  highways    - list of highway definitions to extract from that state's PBF

Each highway definition:
  key          - output JSON filename stem, e.g. "i95_ma" -> highways/i95_ma.json
  displayName  - human-readable label shown in the RoadVoice UI
  state        - two-letter state abbreviation
  ref_tokens   - set of OSM ref= tokens to match (ways whose ref contains ANY of these)
  highway_tags - set of OSM highway= values to match ("motorway", "trunk", etc.)

OSM ref tokens use spaces, not hyphens: "I 95" not "I-95".
Co-signed routes use semicolons in OSM: "I 95;MA 128" — we match on any token.
Run diagnose_pbf.py against a new state's PBF to discover the correct tokens.

OSM Data © OpenStreetMap contributors (ODbL)
"""

STATES = [
    {
        "pbf_state": "massachusetts",
        "pbf_url": "https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf",
        "highways": [
            {
                "key": "i84_ma",
                "displayName": "I-84 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 84"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i90_ma",
                "displayName": "I-90 / Mass Pike (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 90"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i91_ma",
                "displayName": "I-91 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 91"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i93_ma",
                "displayName": "I-93 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 93"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i95_ma",
                "displayName": "I-95 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 95", "MA 128"},  # MA 128 = co-signed beltway
                "highway_tags": {"motorway"},
            },
            {
                "key": "i190_ma",
                "displayName": "I-190 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 190"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i195_ma",
                "displayName": "I-195 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 195"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i290_ma",
                "displayName": "I-290 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 290"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i395_ma",
                "displayName": "I-395 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 395"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i495_ma",
                "displayName": "I-495 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"I 495"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "us3_ma",
                "displayName": "US Route 3 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"US 3", "MA 3"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "ma2_ma",
                "displayName": "MA Route 2 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"MA 2"},
                "highway_tags": {"motorway", "trunk"},
            },
            {
                "key": "ma6_ma",
                "displayName": "MA Route 6 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"US 6"},   # OSM tags Route 6 as US 6 in MA
                "highway_tags": {"motorway", "trunk"},
            },
            {
                "key": "ma24_ma",
                "displayName": "MA Route 24 (Massachusetts)",
                "state": "MA",
                "ref_tokens": {"MA 24"},
                "highway_tags": {"motorway"},
            },
        ],
    },

    # -----------------------------------------------------------------------
    # NEW HAMPSHIRE
    # Run diagnose_pbf.py with the NH PBF to verify ref tokens before use.
    # Download: https://download.geofabrik.de/north-america/us/new-hampshire-latest.osm.pbf
    # -----------------------------------------------------------------------
    {
        "pbf_state": "new-hampshire",
        "pbf_url": "https://download.geofabrik.de/north-america/us/new-hampshire-latest.osm.pbf",
        "highways": [
            {
                "key": "i89_nh",
                "displayName": "I-89 (New Hampshire)",
                "state": "NH",
                "ref_tokens": {"I 89"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i93_nh",
                "displayName": "I-93 (New Hampshire)",
                "state": "NH",
                "ref_tokens": {"I 93"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i95_nh",
                "displayName": "I-95 (New Hampshire)",
                "state": "NH",
                "ref_tokens": {"I 95"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "us3_nh",
                "displayName": "US Route 3 (New Hampshire)",
                "state": "NH",
                "ref_tokens": {"US 3"},
                "highway_tags": {"motorway", "trunk"},
            },
        ],
    },

    # -----------------------------------------------------------------------
    # VERMONT
    # Download: https://download.geofabrik.de/north-america/us/vermont-latest.osm.pbf
    # -----------------------------------------------------------------------
    {
        "pbf_state": "vermont",
        "pbf_url": "https://download.geofabrik.de/north-america/us/vermont-latest.osm.pbf",
        "highways": [
            {
                "key": "i89_vt",
                "displayName": "I-89 (Vermont)",
                "state": "VT",
                "ref_tokens": {"I 89"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i91_vt",
                "displayName": "I-91 (Vermont)",
                "state": "VT",
                "ref_tokens": {"I 91"},
                "highway_tags": {"motorway"},
            },
        ],
    },

    # -----------------------------------------------------------------------
    # CONNECTICUT
    # Download: https://download.geofabrik.de/north-america/us/connecticut-latest.osm.pbf
    # -----------------------------------------------------------------------
    {
        "pbf_state": "connecticut",
        "pbf_url": "https://download.geofabrik.de/north-america/us/connecticut-latest.osm.pbf",
        "highways": [
            {
                "key": "i84_ct",
                "displayName": "I-84 (Connecticut)",
                "state": "CT",
                "ref_tokens": {"I 84"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i91_ct",
                "displayName": "I-91 (Connecticut)",
                "state": "CT",
                "ref_tokens": {"I 91"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i95_ct",
                "displayName": "I-95 (Connecticut)",
                "state": "CT",
                "ref_tokens": {"I 95"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i395_ct",
                "displayName": "I-395 (Connecticut)",
                "state": "CT",
                "ref_tokens": {"I 395"},
                "highway_tags": {"motorway"},
            },
        ],
    },

    # -----------------------------------------------------------------------
    # MAINE
    # Download: https://download.geofabrik.de/north-america/us/maine-latest.osm.pbf
    # -----------------------------------------------------------------------
    {
        "pbf_state": "maine",
        "pbf_url": "https://download.geofabrik.de/north-america/us/maine-latest.osm.pbf",
        "highways": [
            {
                "key": "i95_me",
                "displayName": "I-95 / Maine Turnpike (Maine)",
                "state": "ME",
                "ref_tokens": {"I 95", "I 495"},  # Maine Tpk is co-signed I-95/I-495
                "highway_tags": {"motorway"},
            },
            {
                "key": "i295_me",
                "displayName": "I-295 (Maine)",
                "state": "ME",
                "ref_tokens": {"I 295"},
                "highway_tags": {"motorway"},
            },
        ],
    },

    # -----------------------------------------------------------------------
    # FLORIDA — add more highways as needed
    # Download: https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf
    # -----------------------------------------------------------------------
    {
        "pbf_state": "florida",
        "pbf_url": "https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf",
        "highways": [
            {
                "key": "i4_fl",
                "displayName": "I-4 (Florida)",
                "state": "FL",
                "ref_tokens": {"I 4"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i75_fl",
                "displayName": "I-75 (Florida)",
                "state": "FL",
                "ref_tokens": {"I 75"},
                "highway_tags": {"motorway"},
            },
            {
                "key": "i95_fl",
                "displayName": "I-95 (Florida)",
                "state": "FL",
                "ref_tokens": {"I 95"},
                "highway_tags": {"motorway"},
            },
        ],
    },

    # -----------------------------------------------------------------------
    # Add more states here following the same pattern.
    # Always run diagnose_pbf.py first to confirm ref tokens for a new state.
    # -----------------------------------------------------------------------
]
