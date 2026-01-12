#!/usr/bin/env node
/**
 * Validate city names in brand JSON files
 * Generates bad_locations.txt with locations that have suspicious city names
 */

const fs = require('fs');
const path = require('path');

const BRANDS_DIR = path.join(__dirname, '..', 'brands');
const ZIPCODE_FILE = path.join(__dirname, 'us-zipcodes.csv');
const OFFICIAL_CITIES_DIR = '/Users/johnhanna/Documents/RoadVoice/data/official-cities';
const OUTPUT_FILE = path.join(__dirname, '..', 'bad_locations.txt');

// Load valid cities from ZIP code database
const validCities = new Set();
const zipData = fs.readFileSync(ZIPCODE_FILE, 'utf-8');
for (const line of zipData.split('\n').slice(1)) {
  const parts = line.split(',');
  if (parts.length >= 6) {
    const state = parts[2];
    const city = parts[5];
    if (city && !city.startsWith('Zcta')) {
      validCities.add(`${city.toLowerCase()}|${state}`);
    }
  }
}
console.log(`Loaded ${validCities.size} cities from ZIP database`);

// Load official cities from Census data
let officialCount = 0;
if (fs.existsSync(OFFICIAL_CITIES_DIR)) {
  const files = fs.readdirSync(OFFICIAL_CITIES_DIR);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const state = file.replace('.json', '');
      const data = JSON.parse(fs.readFileSync(path.join(OFFICIAL_CITIES_DIR, file), 'utf-8'));
      for (const entry of data) {
        // Handle both object format {name: "Boston"} and string format "Boston"
        const cityName = typeof entry === 'string' ? entry : entry.name;
        if (cityName) {
          validCities.add(`${cityName.toLowerCase()}|${state}`);
          officialCount++;
        }
      }
    }
  }
}
console.log(`Loaded ${officialCount} cities from official Census data`);
console.log(`Total valid cities: ${validCities.size}`);

// Patterns that indicate bad city names
const BAD_PATTERNS = [
  /\(empty\)/i,
  /^\d/,  // Starts with number
  /^[A-Z]{2,3}$/,  // Just state abbreviation
  /Twp$/i,  // Township suffix
  /Bea$/,  // Truncated "Beach"
  /Hgts$/i,  // Truncated "Heights"
  /Ctr$/i,  // Truncated "Center"
  /Vlg$/i,  // Truncated "Village"
  /\s+-\s*$/,  // Ends with dash
  /^\w+\s+\w+\s+\w+\s+\w+/,  // 4+ words (usually bad)
  // Note: Removed Center$ and Downtown$ patterns - too many valid cities end with these
];

// Check if city looks suspicious
function isSuspicious(city, state) {
  if (!city || city.trim() === '') return true;

  // Check against bad patterns
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(city)) return true;
  }

  // Check if city is in valid cities list
  const key = `${city.toLowerCase()}|${state}`;
  if (!validCities.has(key)) {
    // Try without common suffixes
    const simplified = city
      .replace(/\s+(Township|Twp|Heights|Hgts|Center|Ctr|Village|Vlg)$/i, '')
      .trim();
    const simplifiedKey = `${simplified.toLowerCase()}|${state}`;
    if (!validCities.has(simplifiedKey)) {
      return true;
    }
  }

  return false;
}

// Process all brand files
const badLocations = [];
const brandFiles = fs.readdirSync(BRANDS_DIR).filter(f => f.endsWith('.json'));

console.log(`\nChecking ${brandFiles.length} brand files...`);

for (const file of brandFiles) {
  const brandKey = file.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, file), 'utf-8'));

  for (const loc of data.locations) {
    if (isSuspicious(loc.city, loc.state)) {
      badLocations.push({
        brand: brandKey,
        city: loc.city || '(empty)',
        state: loc.state,
        lat: loc.lat,
        lon: loc.lon,
        address: loc.address || ''
      });
    }
  }
}

// Sort by brand then city
badLocations.sort((a, b) => {
  if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
  return a.city.localeCompare(b.city);
});

// Write output
const header = 'brand\tcity\tstate\tlat\tlon\taddress';
const lines = badLocations.map(l =>
  `${l.brand}\t${l.city}\t${l.state}\t${l.lat}\t${l.lon}\t${l.address}`
);
fs.writeFileSync(OUTPUT_FILE, [header, ...lines].join('\n'));

// Count by brand
const brandCounts = {};
for (const loc of badLocations) {
  brandCounts[loc.brand] = (brandCounts[loc.brand] || 0) + 1;
}

// Calculate total locations
let totalLocations = 0;
for (const file of brandFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(BRANDS_DIR, file), 'utf-8'));
  totalLocations += data.locations.length;
}

console.log(`\n============================================================`);
console.log(`VALIDATION RESULTS`);
console.log(`============================================================`);
console.log(`Total locations: ${totalLocations}`);
console.log(`Bad locations: ${badLocations.length}`);
console.log(`Valid: ${((totalLocations - badLocations.length) / totalLocations * 100).toFixed(2)}%`);
console.log(`\nTop brands with issues:`);

const sorted = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [brand, count] of sorted) {
  console.log(`  ${brand}: ${count}`);
}

console.log(`\nWrote ${badLocations.length} bad locations to bad_locations.txt`);
