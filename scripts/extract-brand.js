#!/usr/bin/env node
/**
 * Extract brand data from AllThePlaces GeoJSON
 *
 * Usage: node scripts/extract-brand.js <brand_key> <spider_name> <display_name> <category>
 *
 * Example:
 *   node scripts/extract-brand.js wendys wendys_us "Wendy's" restaurant
 *
 * This script handles all ATP property name variations:
 * - state: addr:state, state
 * - city: addr:city, city
 * - address: addr:street_address, addr:street, street_address, addr:full
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Parse command line args
const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Usage: node scripts/extract-brand.js <brand_key> <spider_name> <display_name> <category>');
  console.log('Example: node scripts/extract-brand.js wendys wendys_us "Wendys" restaurant');
  process.exit(1);
}

const [brandKey, spiderName, displayName, category] = args;

const DATA_DIR = path.join(__dirname, '..', 'brands');
const ZIP_FILE = '/Users/johnhanna/Documents/RoadVoice/data/output.zip';
const MANIFEST_FILE = path.join(__dirname, '..', 'manifest.json');

/**
 * Extract property from ATP GeoJSON feature, trying multiple name variations
 */
function getProperty(props, ...keys) {
  for (const key of keys) {
    if (props[key]) return props[key];
  }
  return '';
}

// US state names for matching
const STATE_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'
];

/**
 * Extract city from addr:full if separate city field is missing
 * Handles multiple formats:
 * - "123 Main St, City, ST 12345"
 * - "123 Main St, City, State, ST 12345"
 * - "123 Main St, Location Detail, City, State, ST 12345"
 */
function extractCityFromFull(addrFull) {
  if (!addrFull) return '';
  const parts = addrFull.split(',').map(p => p.trim());
  if (parts.length < 2) return '';

  // Find the index of a state name
  let stateIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    if (STATE_NAMES.some(s => s.toLowerCase() === parts[i].toLowerCase())) {
      stateIndex = i;
      break;
    }
  }

  // If we found a state name, city is the part right before it
  if (stateIndex > 1) {
    const city = parts[stateIndex - 1];
    // Validate it looks like a city (not a number, not a suite/space)
    if (city && !city.match(/^\d/) && !city.match(/^(space|suite|unit|floor|room)/i)) {
      return city;
    }
  }

  // Fallback: try second part if it doesn't look like a location detail
  const secondPart = parts[1];
  if (secondPart && !secondPart.match(/^\d/) &&
      !secondPart.match(/^(space|suite|unit|floor|room|mall)/i) &&
      !STATE_NAMES.some(s => s.toLowerCase() === secondPart.toLowerCase())) {
    return secondPart;
  }

  return '';
}

// Common US county names that appear in "City County" format
// Include compound names like "Salt Lake", "New York" that may appear
const COUNTY_NAMES = [
  // Compound county names (check these first - order matters)
  'Salt Lake', 'New York', 'New Haven', 'Fond du Lac', 'Eau Claire',
  'District of Columbia', 'Prince George', 'Anne Arundel', 'Prince William',
  'St. Louis', 'St. Clair', 'Palm Beach', 'Miami-Dade', 'Los Angeles',
  'San Diego', 'San Francisco', 'San Bernardino', 'San Mateo', 'Santa Clara',
  'Contra Costa', 'El Paso',
  // Single-word county names
  'Broward', 'Harris', 'Bexar', 'Dallas', 'Tarrant', 'Travis', 'Maricopa',
  'Pima', 'Clark', 'Washoe', 'King', 'Pierce', 'Snohomish', 'Multnomah',
  'Clackamas', 'Sacramento', 'Orange', 'Riverside', 'Alameda', 'Fresno',
  'Kern', 'Ventura', 'Cook', 'DuPage', 'Lake', 'Will', 'Kane', 'Wayne',
  'Oakland', 'Macomb', 'Cuyahoga', 'Franklin', 'Hamilton', 'Montgomery',
  'Summit', 'Lucas', 'Allegheny', 'Philadelphia', 'Delaware', 'Bucks',
  'Chester', 'Lancaster', 'Suffolk', 'Nassau', 'Westchester', 'Erie',
  'Monroe', 'Onondaga', 'Queens', 'Middlesex', 'Essex', 'Bergen', 'Hudson',
  'Union', 'Passaic', 'Morris', 'Monmouth', 'Ocean', 'Camden', 'Burlington',
  'Gloucester', 'Mercer', 'Fairfax', 'Loudoun', 'Arlington', 'Henrico',
  'Chesterfield', 'Hillsborough', 'Pinellas', 'Duval', 'Seminole', 'Volusia',
  'Lee', 'Polk', 'Brevard', 'Pasco', 'Sarasota', 'Manatee', 'Collier',
  'Marion', 'Fulton', 'DeKalb', 'Gwinnett', 'Cobb', 'Clayton', 'Cherokee',
  'Forsyth', 'Henry', 'Douglas', 'Rockdale', 'Newton', 'Paulding', 'Fayette',
  'Carroll', 'Mecklenburg', 'Wake', 'Guilford', 'Cumberland', 'Durham',
  'Buncombe', 'Gaston', 'Cabarrus', 'Iredell', 'Catawba', 'Rowan', 'Davidson',
  'Greenville', 'Richland', 'Charleston', 'Horry', 'Spartanburg', 'Lexington',
  'York', 'Berkeley', 'Dorchester', 'Anderson', 'Aiken', 'Beaufort', 'Shelby',
  'Knox', 'Rutherford', 'Williamson', 'Sumner', 'Wilson', 'Blount', 'Sullivan',
  'Washington', 'Sevier', 'Jefferson', 'Madison', 'Mobile', 'Baldwin',
  'Tuscaloosa', 'Morgan', 'Etowah', 'Calhoun', 'Houston', 'Limestone',
  'Collin', 'Denton', 'Tulsa', 'Denver', 'Milwaukee', 'Spokane', 'Salt',
  'Midland', 'Lubbock', 'Pueblo', 'Yuma', 'Florence', 'Hartford', 'Madera',
  'Victoria', 'Kenosha', 'Waukesha', 'Yakima', 'Monterey'
];

/**
 * Clean up city name - remove state suffixes, abbreviations, county names, etc.
 */
function cleanCity(city) {
  if (!city) return '';

  // Handle "City City" pattern (e.g., "Denver Denver" -> "Denver")
  const words = city.split(' ');
  if (words.length >= 2) {
    // Check if city name is repeated
    const half = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      city = firstHalf;
    }
  }

  // Remove trailing county names (e.g., "Sunrise Broward" -> "Sunrise")
  // Try compound names first, then single words
  // Don't strip if it would leave a very short result (< 4 chars)
  for (const county of COUNTY_NAMES) {
    const regex = new RegExp(`\\s+${county}$`, 'i');
    if (regex.test(city)) {
      const stripped = city.replace(regex, '').trim();
      if (stripped.length >= 4) {
        city = stripped;
      }
      break;
    }
  }

  // Remove trailing state abbreviations and zip codes (e.g., "Cambridge MA 02141" -> "Cambridge")
  city = city.replace(/\s+[A-Z]{2}\s*\d{5}(-\d{4})?$/, '');

  // Remove trailing state abbreviations (e.g., "Cambridge MA" -> "Cambridge")
  city = city.replace(/\s+[A-Z]{2}$/, '');

  // Remove common suffixes
  city = city.replace(/\s+(Mass|USA|US)$/i, '');

  // Remove leading/trailing spaces
  city = city.trim();

  return city;
}

/**
 * Normalize city name to match cities database format
 */
function normalizeCity(city, state) {
  if (!city) return '';

  // Convert ALL CAPS or all lowercase to proper case
  if ((city === city.toUpperCase() || city === city.toLowerCase()) && city.length > 2) {
    city = city.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // Fix "Mc" capitalization (Mckinney -> McKinney, Mcallen -> McAllen)
  city = city.replace(/\bMc([a-z])/g, (match, letter) => 'Mc' + letter.toUpperCase());

  // NY-specific normalizations
  if (state === 'NY') {
    if (city === 'New York') return 'New York City';
    if (city === 'Bronx') return 'The Bronx';
  }

  // Ontario-specific normalizations (Toronto neighborhoods)
  if (state === 'ON') {
    if (city === 'Scarborough' || city === 'North York') return 'Toronto';
  }

  // Quebec - Montreal variations
  if (state === 'QC') {
    if (city === 'Montréal' || city === 'Montreal') return 'Montréal';
    if (city === 'Québec' || city === 'Quebec') return 'Québec';
  }

  // Saint -> St. normalization (cities DB uses "St.")
  city = city.replace(/\bSaint\s+/gi, 'St. ');

  // "St " -> "St. " (add missing period)
  city = city.replace(/\bSt\s+(?=[A-Z])/g, 'St. ');

  // Fond du Lac, King of Prussia, etc. (proper casing)
  city = city.replace(/\bDu\b/gi, 'du');
  city = city.replace(/\bDe\b/gi, 'de');
  city = city.replace(/\bOf\b/gi, 'of');

  return city;
}

/**
 * Extract city from Hannaford-style name field
 * Format: "Brand - Location Address - City"
 */
function extractCityFromName(name) {
  if (!name) return '';
  const parts = name.split(' - ');
  if (parts.length >= 2) {
    // City is the last part
    const city = parts[parts.length - 1].trim();
    // Make sure it's not an address (shouldn't start with number)
    if (city && !city.match(/^\d/)) {
      return city;
    }
  }
  return '';
}

console.log(`Extracting ${brandKey} from ${spiderName}...`);

try {
  // Extract GeoJSON from zip
  const geojsonFile = `output/${spiderName}.geojson`;
  const tmpFile = `/tmp/${spiderName}.geojson`;

  try {
    execSync(`unzip -p "${ZIP_FILE}" "${geojsonFile}" > "${tmpFile}"`, { stdio: 'pipe' });
  } catch (err) {
    console.error(`Spider "${spiderName}" not found in ATP data`);
    console.log('\nSearching for similar names...');
    const searchResult = execSync(`unzip -l "${ZIP_FILE}" | grep -i "${brandKey}" | head -10`, { encoding: 'utf-8' });
    console.log(searchResult || 'No matches found');
    process.exit(1);
  }

  const raw = fs.readFileSync(tmpFile, 'utf-8');
  if (raw.length === 0) {
    console.error('Empty GeoJSON file');
    process.exit(1);
  }

  const data = JSON.parse(raw);

  // Filter and transform locations
  const locations = data.features
    .filter(f => f.properties && f.geometry && f.geometry.coordinates)
    .filter(f => {
      // Only US locations (or empty country which usually means US)
      const country = getProperty(f.properties, 'addr:country', 'country');
      return country === 'US' || country === '';
    })
    .map(f => {
      const props = f.properties;

      // Try all property name variations
      const state = getProperty(props, 'addr:state', 'state');
      let city = getProperty(props, 'addr:city', 'city');
      const address = getProperty(props, 'addr:street_address', 'addr:street', 'street_address', 'addr:full');

      // Fallback 1: extract city from addr:full if missing
      if (!city) {
        city = extractCityFromFull(props['addr:full']);
      }

      // Fallback 2: extract city from name field (Hannaford style: "Brand - Location - City")
      if (!city) {
        city = extractCityFromName(props['name']);
      }

      // Fallback 3: try to find city name embedded in addr:full (for malformed addresses)
      if (!city && props['addr:full']) {
        // Look for pattern "City State" or "City, State" where State is the full state name
        for (const stateName of STATE_NAMES) {
          const regex = new RegExp(`([A-Za-z\\s]+?)\\s+${stateName}`, 'i');
          const match = props['addr:full'].match(regex);
          if (match) {
            // Extract the last word before the state name as the city
            const words = match[1].trim().split(/\s+/);
            const lastWord = words[words.length - 1];
            if (lastWord && lastWord.length > 1 && !lastWord.match(/^\d/) &&
                !lastWord.match(/^(blvd|st|ave|rd|dr|ln|ct|way|pk|pkwy|hwy)$/i)) {
              city = lastWord;
              break;
            }
          }
        }
      }

      // Clean and normalize the city name
      const cleanedCity = cleanCity(city);
      const normalizedCity = normalizeCity(cleanedCity, state);

      return {
        lat: Math.round(f.geometry.coordinates[1] * 1000000) / 1000000,
        lon: Math.round(f.geometry.coordinates[0] * 1000000) / 1000000,
        city: normalizedCity,
        state: state,
        address: address,
        name: ''
      };
    });

  if (locations.length === 0) {
    console.error('No US locations found');
    process.exit(1);
  }

  // Report data quality
  const withState = locations.filter(l => l.state).length;
  const withCity = locations.filter(l => l.city).length;
  const withAddress = locations.filter(l => l.address).length;

  console.log(`  Total locations: ${locations.length}`);
  console.log(`  With state: ${withState} (${Math.round(withState/locations.length*100)}%)`);
  console.log(`  With city: ${withCity} (${Math.round(withCity/locations.length*100)}%)`);
  console.log(`  With address: ${withAddress} (${Math.round(withAddress/locations.length*100)}%)`);

  // Build brand data
  const brandData = {
    key: brandKey,
    displayName: displayName,
    category: category,
    useLocationName: false,
    locations: locations
  };

  // Write brand file with readable formatting
  const outPath = path.join(DATA_DIR, `${brandKey}.json`);
  let jsonStr = JSON.stringify(brandData)
    .replace(/"locations":\[/, '"locations":[\n  ')
    .replace(/\},\{/g, '},\n  {');
  fs.writeFileSync(outPath, jsonStr);

  const fileSize = fs.statSync(outPath).size;
  const checksum = crypto.createHash('md5').update(fs.readFileSync(outPath)).digest('hex');

  console.log(`  File size: ${Math.round(fileSize/1024)}KB`);
  console.log(`  Checksum: ${checksum}`);

  // Update manifest
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  manifest.brands[brandKey] = {
    displayName: displayName,
    category: category,
    useLocationName: false,
    locationCount: locations.length,
    fileSize: fileSize,
    checksum: checksum
  };
  manifest.generated = new Date().toISOString();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Created brands/${brandKey}.json with ${locations.length} locations`);
  console.log(`✓ Updated manifest.json`);

} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
