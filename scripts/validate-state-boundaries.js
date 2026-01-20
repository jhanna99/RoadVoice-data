#!/usr/bin/env node
/**
 * Validate that location coordinates fall within the stated state's boundaries
 * Uses bounding box from StateBoundaries.txt to detect mismatched state/coordinates
 */

const fs = require('fs');
const path = require('path');

const BRANDS_DIR = path.join(__dirname, '..', 'brands');
const BOUNDARIES_FILE = path.join(__dirname, '..', 'StateBoundaries.txt');
const OUTPUT_FILE = path.join(__dirname, '..', 'state_boundary_errors.txt');

// Map state names to abbreviations
const STATE_ABBREV = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'District of Columbia': 'DC',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL',
  'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA',
  'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
  'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
  'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA',
  'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

// DC boundaries (manually added since not in StateBoundaries.txt)
const DC_BOUNDS = {
  name: 'District of Columbia',
  north: 38.995548,
  south: 38.791645,
  east: -76.909393,
  west: -77.119759
};

// Parse state boundaries from file
function loadStateBoundaries() {
  const content = fs.readFileSync(BOUNDARIES_FILE, 'utf-8');
  const boundaries = {};

  // Match lines like: ("Florida", 31.000888, 24.523096, -80.031362, -87.634938),
  const regex = /\("([^"]+)",\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const [, stateName, northLat, southLat, eastLon, westLon] = match;
    const abbrev = STATE_ABBREV[stateName];
    if (abbrev) {
      boundaries[abbrev] = {
        name: stateName,
        north: parseFloat(northLat),
        south: parseFloat(southLat),
        east: parseFloat(eastLon),
        west: parseFloat(westLon)
      };
    }
  }

  return boundaries;
}

// Check if a coordinate is within a state's bounding box
function isInState(lat, lon, bounds) {
  // Handle Alaska's 180° meridian crossing specially
  if (bounds.west > 0 && bounds.east < 0) {
    // Alaska case: west is positive (like 179°), east is negative (like -130°)
    const lonInRange = lon >= bounds.west || lon <= bounds.east;
    return lat <= bounds.north && lat >= bounds.south && lonInRange;
  }

  return lat <= bounds.north &&
         lat >= bounds.south &&
         lon <= bounds.east &&
         lon >= bounds.west;
}

// Find which state(s) a coordinate actually belongs to
function findActualState(lat, lon, boundaries) {
  const matches = [];
  for (const [abbrev, bounds] of Object.entries(boundaries)) {
    if (isInState(lat, lon, bounds)) {
      matches.push(abbrev);
    }
  }
  return matches;
}

// Main validation
const boundaries = loadStateBoundaries();
boundaries['DC'] = DC_BOUNDS;  // Add DC manually
console.log(`Loaded boundaries for ${Object.keys(boundaries).length} states (including DC)`);

const errors = [];
const brandFiles = fs.readdirSync(BRANDS_DIR).filter(f => f.endsWith('.json'));

console.log(`Checking ${brandFiles.length} brand files...`);

let totalLocations = 0;
let skippedLocations = 0;

for (const file of brandFiles) {
  const brandKey = file.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, file), 'utf-8'));

  for (const loc of data.locations) {
    totalLocations++;

    // Only validate locations claiming to be in 50 US states + DC
    const bounds = boundaries[loc.state];
    if (!bounds) {
      skippedLocations++;
      continue;
    }

    // Check if coordinates are within stated state
    if (!isInState(loc.lat, loc.lon, bounds)) {
      const actualStates = findActualState(loc.lat, loc.lon, boundaries);
      errors.push({
        brand: brandKey,
        city: loc.city || '(empty)',
        statedState: loc.state,
        actualStates: actualStates.length > 0 ? actualStates.join('/') : 'NONE',
        lat: loc.lat,
        lon: loc.lon,
        address: loc.address || ''
      });
    }
  }
}

// Sort by brand then stated state
errors.sort((a, b) => {
  if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
  return a.statedState.localeCompare(b.statedState);
});

// Write output
const header = 'brand\tcity\tstated_state\tactual_state\tlat\tlon\taddress';
const lines = errors.map(e =>
  `${e.brand}\t${e.city}\t${e.statedState}\t${e.actualStates}\t${e.lat}\t${e.lon}\t${e.address}`
);
fs.writeFileSync(OUTPUT_FILE, [header, ...lines].join('\n'));

// Count by brand
const brandCounts = {};
for (const err of errors) {
  brandCounts[err.brand] = (brandCounts[err.brand] || 0) + 1;
}

const validatedLocations = totalLocations - skippedLocations;

console.log(`\n============================================================`);
console.log(`STATE BOUNDARY VALIDATION RESULTS`);
console.log(`============================================================`);
console.log(`Total locations: ${totalLocations}`);
console.log(`Skipped (non-US): ${skippedLocations}`);
console.log(`Validated (US): ${validatedLocations}`);
console.log(`Boundary errors: ${errors.length}`);
console.log(`Valid: ${((validatedLocations - errors.length) / validatedLocations * 100).toFixed(2)}%`);

if (errors.length > 0) {
  console.log(`\nBrands with boundary errors:`);
  const sorted = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  for (const [brand, count] of sorted) {
    console.log(`  ${brand}: ${count}`);
  }

  console.log(`\nSample errors:`);
  for (const err of errors.slice(0, 10)) {
    console.log(`  ${err.brand}: ${err.city}, ${err.statedState} -> actually in ${err.actualStates} (${err.lat}, ${err.lon})`);
  }
}

console.log(`\nWrote ${errors.length} errors to state_boundary_errors.txt`);
