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

// Add common valid city name variations not in Census/ZIP data
const EXTRA_VALID_CITIES = {
  'NY': ['New York City', 'The Bronx', 'Queens', 'Brooklyn', 'Staten Island', 'Long Island City', 'Elmhurst', 'Flushing', 'Jamaica', 'Astoria', 'Woodside', 'Jackson Heights', 'Corona', 'Rego Park', 'Forest Hills', 'Bayside', 'Fresh Meadows', 'Whitestone', 'College Point', 'Ridgewood', 'Maspeth', 'Middle Village', 'Glendale', 'Woodhaven', 'Ozone Park', 'Howard Beach', 'Richmond Hill', 'Kew Gardens', 'Sunnyside', 'Far Rockaway', 'Arverne', 'Rockaway Park', 'Belle Harbor', 'Breezy Point', 'Glenville', 'Manhattan', 'Malta', 'Farmington', 'Dewitt', 'Halfmoon', 'East Amherst', 'South Richmond Hill'],
  'CA': ['Hollywood', 'Pacoima', 'Ventura', 'City of Industry', 'Van Nuys', 'North Hollywood', 'Sherman Oaks', 'Encino', 'Tarzana', 'Woodland Hills', 'Canoga Park', 'Northridge', 'Granada Hills', 'Sylmar', 'Sun Valley', 'Panorama City', 'Reseda', 'Winnetka', 'Chatsworth', 'Porter Ranch', 'Lake Balboa', 'Valley Village', 'Studio City', 'Sunland', 'Camp Pendleton', 'Saugus', 'La Canada Flintridge', 'La Canada', 'West Los Angeles', 'Pacific Palisades', 'Westchester', 'Highland Park', 'Greenbrae', 'Anaheim Hills', 'North Palm Springs', 'Agoura'],
  'TX': ['Kingwood', 'Ft. Worth', 'Ft Worth', 'Lacy Lakeview'],
  'MA': ['Hyannis', 'Centerville', 'Osterville', 'Cotuit', 'Marstons Mills', 'West Barnstable', 'Chelmsford', 'Dartmouth', 'Westford', 'Chestnut Hill', 'South Attleboro'],
  'VA': ['Henrico', 'North Chesterfield', 'Gloucester', 'Bristow', 'Spotsylvania', 'Zion Crossroads'],
  'CT': ['Stratford', 'Vernon', 'Lisbon', 'Willington', 'Milldale'],
  'FL': ['St. Johns', 'Ft. Lauderdale', 'Ft Lauderdale', 'Ft. Myers', 'Ft Myers', 'Viera', 'Ponte Vedra Beach', 'Ponte Vedra', 'Clearwater Beach', 'University Park', 'Pensacola Beach'],
  'MO': ["O'Fallon", 'O Fallon', 'St. Louis Downtown'],
  'IL': ['O Fallon', "O'Fallon", 'Lake In The Hills', 'Mt Vernon', 'Mt. Vernon', 'Mt Prospect', 'Mt. Prospect'],
  'NJ': ['Pennsauken', 'Egg Harbor Township', 'East Windsor', 'Neptune', 'Middletown', 'Ewing', 'Delran', 'Medford', 'Mount Holly', 'Galloway', 'Westampton', 'Little Falls', 'West Deptford', 'Branchburg', 'Robbinsville', 'Rochelle Park', 'Mt. Laurel', 'Mt Laurel', 'Lawrence Township', 'Cape May Court House'],
  'SC': ['Indian Land', 'Mt Pleasant', 'Mt. Pleasant', 'Mount Pleasant', 'Hilton Head', 'Hilton Head Island'],
  'MI': ['Clarkston', 'Commerce Township', 'Sault Sainte Marie', 'Sault Ste. Marie', 'Sault Ste Marie', 'Brownstown', 'Mt. Pleasant', 'Shelby Twp', 'Shelby Township'],
  'RI': ['Johnston', 'North Providence', 'Wakefield', 'South Kingstown'],
  'OH': ['Liberty Township'],
  'MN': ['White Bear', 'White Bear Lake', 'St. Anthony'],
  'PR': ['San Juan', 'Bayamon', 'Carolina', 'Ponce', 'Caguas', 'Guaynabo', 'Mayaguez', 'Arecibo', 'Fajardo', 'Humacao'],
  'GA': ['Ellenwood', 'St. Simons Island', 'St Simons Island'],
  'MS': ['Diberville', "D'Iberville"],
  'PA': ['Moon Township', 'Hazle Township', 'Huntingdon Valley', 'Feasterville Trevose', 'Feasterville-Trevose', 'Abington', 'East Norriton', 'Southampton'],
  'TN': ['Mt. Juliet', 'Mt Juliet', 'Mount Juliet', 'Mc Minnville', 'McMinnville'],
  'MD': ['Hunt Valley', 'Lavale', 'LaVale', 'Windsor Mill'],
  'CO': ['Falcon'],
  'UT': ['West Valley', 'West Valley City'],
  'WI': ['Grand Chute'],
  'HI': ['Kailua-Kona', 'Kailua Kona'],
  'WV': ['Mineral Wells'],
  'WA': ['Tulalip'],
  'NC': ['Supply'],
  'VT': ['Berlin'],
  'ME': ['Lebanon'],
  'GA': ['Ellenwood', 'St. Simons Island', 'St Simons Island', 'Fort Benning'],
  'AL': ['Columbus'],
  'ID': ["Coeur D' Alene", 'Coeur D Alene', "Coeur d'Alene"],
  'MO': ["O'Fallon", 'O Fallon', 'St. Louis Downtown', 'Sainte Genevieve', 'Ste. Genevieve'],
  'VA': ['Henrico', 'North Chesterfield', 'Gloucester', 'Bristow', 'Spotsylvania', 'Zion Crossroads', 'North Tazewell'],
  'KY': ['Mt Sterling', 'Mt. Sterling', 'LaGrange'],
  'IN': ['LaPorte'],
  'LA': ['Greenwell Springs', 'St. Amant'],
  'PA': ['Moon Township', 'Hazle Township', 'Huntingdon Valley', 'Feasterville Trevose', 'Feasterville-Trevose', 'Abington', 'East Norriton', 'Southampton', 'Essington', 'Coal Township'],
  'WV': ['Mineral Wells', 'Berkeley Springs'],
  'DE': ['Rehoboth', 'Rehoboth Beach'],
  'NV': ['Primm', 'N Las Vegas', 'North Las Vegas', 'Jean'],
  'UT': ['West Valley', 'West Valley City', 'Lake Point', 'Spanish Fork'],
  'OH': ['Liberty Township', 'Mt. Vernon', 'Mt Vernon', 'Mount Vernon'],
  'CO': ['Falcon', 'Ft. Collins', 'Ft Collins', 'Fort Collins'],
  'OK': ['Fort Smith'],
  'MD': ['Hunt Valley', 'Lavale', 'LaVale', 'Windsor Mill', 'Finksburg'],
};

for (const [state, cities] of Object.entries(EXTRA_VALID_CITIES)) {
  for (const city of cities) {
    validCities.add(`${city.toLowerCase()}|${state}`);
  }
}
console.log(`Added ${Object.values(EXTRA_VALID_CITIES).flat().length} extra valid city names`);
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

// Canadian provinces - skip validation (we only have US reference data)
const CANADIAN_PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);

// Check if city looks suspicious
function isSuspicious(city, state) {
  if (!city || city.trim() === '') return true;

  // Skip Canadian provinces - we don't have reference data for them
  if (CANADIAN_PROVINCES.has(state)) return false;

  // Check if city is in valid cities list FIRST (before pattern checks)
  const key = `${city.toLowerCase()}|${state}`;
  if (validCities.has(key)) {
    return false; // City is in our valid list
  }

  // Try without common suffixes
  const simplified = city
    .replace(/\s+(Township|Twp|Heights|Hgts|Center|Ctr|Village|Vlg)$/i, '')
    .trim();
  const simplifiedKey = `${simplified.toLowerCase()}|${state}`;
  if (validCities.has(simplifiedKey)) {
    return false; // Simplified city is in our valid list
  }

  // Check against bad patterns (only for cities not in our valid list)
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(city)) return true;
  }

  // Not in valid list, flag as suspicious
  return true;
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
