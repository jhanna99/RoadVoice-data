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
  console.log('Usage: node scripts/extract-brand.js <brand_key> <spider_name> <display_name> <category> [filterBrand]');
  console.log('Example: node scripts/extract-brand.js wendys wendys_us "Wendys" restaurant');
  console.log('Example with filter: node scripts/extract-brand.js mobil exxon_mobil "Mobil" gas_station Mobil');
  process.exit(1);
}

const [brandKey, spiderName, displayName, category, filterBrand] = args;

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

// Legitimate cities with repeated words (don't treat as duplicates)
const REPEATED_WORD_CITIES = [
  'Paw Paw', 'Walla Walla', 'Bora Bora', 'Ding Dong', 'Wagga Wagga',
  'Baden Baden', 'Bala Bala', 'Sing Sing', 'Coeur d\'Alene'
];

// Cities ending with "Summit" (Summit is a county name)
const SUMMIT_CITIES = [
  'Lee\'s Summit', 'Lees Summit', 'Blue Summit', 'Park Summit', 'Oak Summit',
  'Clarks Summit', 'Holts Summit', 'Grants Summit'
];

// Cities that should NEVER have their endings stripped (they end with county names)
const PROTECTED_CITIES = [
  // Cities ending with "Wayne"
  'Fort Wayne', 'Lake Wayne', 'Port Wayne',
  // Cities ending with "Palm Beach" or "Beach"
  'West Palm Beach', 'North Palm Beach', 'Palm Beach', 'Long Beach', 'Virginia Beach',
  'Myrtle Beach', 'Delray Beach', 'Pompano Beach', 'Deerfield Beach', 'Boynton Beach',
  'Huntington Beach', 'Newport Beach', 'Laguna Beach', 'Hermosa Beach', 'Redondo Beach',
  'Manhattan Beach', 'Seal Beach', 'Solana Beach', 'Imperial Beach', 'Pismo Beach',
  // Cities ending with "Lake" (Lake is a county name in many states)
  'Salt Lake', 'Lake', 'Crystal Lake', 'Spring Lake', 'Clear Lake', 'Round Lake',
  'Silver Lake', 'Long Lake', 'Twin Lake', 'White Lake', 'Green Lake', 'Big Lake',
  'Grass Lake', 'Bear Lake', 'Storm Lake', 'Spirit Lake', 'Indian Lake', 'Bass Lake',
  'Eagle Lake', 'Elk Lake', 'Deer Lake', 'Fox Lake', 'Torch Lake', 'Gull Lake',
  'Burt Lake', 'Higgins Lake', 'Houghton Lake', 'Portage Lake', 'Walled Lake',
  'Orchard Lake', 'Commerce Lake', 'Union Lake', 'Williams Lake', 'Cadillac Lake',
  'Balsam Lake', 'Rice Lake', 'Turtle Lake', 'Shell Lake', 'Cameron Lake',
  'Cass Lake', 'Horn Lake', 'Devils Lake', 'Elbow Lake', 'Wonder Lake', 'Third Lake',
  'Minnesota Lake', 'Ottawa Lake', 'Pleasant Lake', 'Hubbard Lake', 'Howard Lake',
  'Canyon Lake', 'Manitou Lake', 'Diamond Lake', 'Moose Lake', 'Otter Lake',
  'Tupper Lake', 'Saranac Lake', 'Sylvan Lake', 'Island Lake', 'Croton Lake',
  'Swan Lake', 'Pell Lake', 'Lady Lake', 'Bonney Lake', 'Moses Lake', 'Prior Lake',
  'Forest Lake', 'White Lake', 'Rice Lake', 'Spirit Lake', 'Clear Lake', 'Walled Lake',
  'Canyon Lake', 'Devils Lake', 'Mohegan Lake', 'Carter Lake',
  // Cities ending with "Marion", "Franklin", etc.
  'Mount Marion', 'Lake Marion',
  // Cities ending with "Washington", "Jefferson", "Madison", etc.
  'Mount Washington', 'Port Washington', 'Lake Washington',
  'Mount Jefferson', 'Port Jefferson', 'Lake Jefferson',
  'Fort Madison', 'Lake Madison', 'Port Madison',
  // Cities ending with "Jackson"
  'Port Jackson', 'Lake Jackson', 'Fort Jackson',
  // Cities ending with "Hamilton"
  'Mount Hamilton', 'Lake Hamilton', 'Port Hamilton',
  // Cities ending with "Montgomery"
  'Mount Montgomery',
  // Cities ending with "Houston"
  'Lake Houston', 'Port Houston',
  // Cities ending with "Charleston"
  'North Charleston', 'West Charleston',
  // Other protected compound city names
  'Mount Pleasant', 'Mount Vernon', 'Mount Prospect', 'Mount Laurel', 'Mount Holly',
  'Mount Morris', 'Mount Clemens', 'Mount Olive', 'Mount Airy', 'Mount Carmel',
  'Mount Dora', 'Mount Juliet', 'Mount Kisco', 'Mount Lebanon', 'Mount Rainier',
  'West Sacramento', 'South San Francisco', 'East Palo Alto', 'North Hollywood',
  'Port St. Lucie', 'Port Orange', 'Port Arthur', 'Port Huron', 'Port Charlotte',
  // Fort cities (many end with county names like Pierce, Lee, Knox, etc.)
  'Fort Worth', 'Fort Lauderdale', 'Fort Myers', 'Fort Collins', 'Fort Smith',
  'Fort Pierce', 'Fort Lee', 'Fort Knox', 'Fort Dodge', 'Fort Walton Beach',
  'Fort Bragg', 'Fort Morgan', 'Fort Payne', 'Fort Valley', 'Fort Oglethorpe',
  'Fort Atkinson', 'Fort Mill', 'Fort Scott', 'Fort Thomas', 'Fort Mitchell',
  'Fort Meade', 'Fort White', 'Fort McCoy', 'North Fort Myers',
  // West/East/North/South cities (many end with county names like Union, Chester, etc.)
  'West Chester', 'East Orange', 'North Bergen', 'South Bend', 'Grand Rapids',
  'West Orange', 'East Dallas', 'North Dallas', 'South Dallas',
  'West Jefferson', 'East Jefferson', 'North Jefferson',
  'West Union', 'East Union', 'North Union', 'South Union',
  'West Salem', 'East Salem', 'North Salem', 'South Salem',
  'West Monroe', 'East Monroe', 'North Monroe', 'South Monroe',
  'West Columbia', 'East Columbia', 'North Columbia', 'South Columbia',
  'West Haven', 'East Haven', 'North Haven', 'South Haven',
  'West Point', 'East Point', 'North Point', 'South Point',
  'West Liberty', 'East Liberty', 'North Liberty', 'South Liberty',
  // Cities ending with county names (Douglas, Union, etc.)
  'Camp Douglas', 'Fort Douglas', 'Castle Douglas',
  'Fork Union', 'Port Union', 'Mount Union',
  'Canyon Country', 'Canyon City',
  // Major cities
  'San Diego', 'San Francisco', 'San Jose', 'San Antonio', 'Los Angeles',
  'Las Vegas', 'El Paso', 'St. Louis', 'St. Paul', 'St. Petersburg',
  'New York', 'New Orleans', 'New Haven', 'New Bedford',
  // Cities ending with county names
  'Royal Oak', 'Royal Palm Beach', 'Lake Worth', 'Lake Charles', 'Lake City',
  'Lake Placid', 'Lake Forest', 'Lake Oswego', 'Lake Geneva', 'Lake Havasu City',
  'Cedar Rapids', 'Grand Prairie', 'Oak Park', 'Oak Lawn', 'Oak Ridge',
  'Coral Springs', 'Palm Springs', 'Palm Coast', 'Palm Bay', 'Palm Harbor',
  'Belle Vernon', 'Mount Vernon', 'East Cleveland', 'West Cleveland',
  'South Charleston', 'North Charleston', 'East Chicago', 'West Chicago',
  // Additional protected cities
  'Corte Madera', 'Liberty Lake', 'Budd Lake', 'June Lake', 'Whitmore Lake',
  'Battle Lake', 'Long Lake', 'Island Lake', 'Third Lake', 'Wonder Lake',
  'Paddock Lake', 'Round Lake', 'Mirror Lake', 'Sturgeon Lake', 'Green Lake'
];

// Common US county names that appear in "City County" format
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
  'Victoria', 'Kenosha', 'Waukesha', 'Yakima', 'Monterey', 'Jackson'
];

/**
 * Clean up city name - remove state suffixes, abbreviations, county names, etc.
 */
function cleanCity(city) {
  if (!city) return '';

  // Handle "City City" pattern (e.g., "Denver Denver" -> "Denver")
  // But preserve legitimate repeated-word cities like "Paw Paw", "Walla Walla"
  const words = city.split(' ');
  if (words.length >= 2) {
    // Check if city name is repeated
    const half = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      // Check if this is a legitimate repeated-word city
      const isLegitimate = REPEATED_WORD_CITIES.some(
        c => c.toLowerCase() === city.toLowerCase()
      );
      if (!isLegitimate) {
        city = firstHalf;
      }
    }
  }

  // Remove trailing county names (e.g., "Houston Harris" -> "Houston")
  // But protect legitimate city names like "Fort Wayne", "West Palm Beach"
  const isProtected = PROTECTED_CITIES.some(
    p => p.toLowerCase() === city.toLowerCase()
  ) || SUMMIT_CITIES.some(
    p => p.toLowerCase() === city.toLowerCase()
  );

  // Single words that should NEVER be left after stripping (they're prefixes, not cities)
  const INVALID_SINGLE_WORDS = [
    'mount', 'fort', 'port', 'west', 'east', 'north', 'south', 'lake', 'big',
    'bear', 'deer', 'elk', 'fox', 'eagle', 'wolf', 'bass', 'grass', 'pine',
    'oak', 'cedar', 'maple', 'spring', 'crystal', 'silver', 'golden', 'royal',
    'grand', 'little', 'new', 'old', 'upper', 'lower', 'middle', 'center',
    'saint', 'san', 'santa', 'las', 'los', 'el', 'la', 'del', 'de',
    // Additional invalid words that appear in compound city names
    'lees', 'lee\'s', 'horn', 'moses', 'bonney', 'clarks', 'holts', 'corte',
    'prior', 'forest', 'rice', 'liberty', 'lady', 'walla', 'devils', 'devil\'s',
    'budd', 'mohegan', 'island', 'third', 'wonder', 'mirror', 'battle', 'canal',
    'mentor', 'young', 'sour', 'white', 'clear', 'storm', 'spirit', 'carter'
  ];

  if (!isProtected) {
    // Try compound names first, then single words
    for (const county of COUNTY_NAMES) {
      const regex = new RegExp(`\\s+${county}$`, 'i');
      if (regex.test(city)) {
        const stripped = city.replace(regex, '').trim();
        // Only strip if result is >= 4 chars AND not an invalid single word
        const isInvalidSingle = INVALID_SINGLE_WORDS.includes(stripped.toLowerCase());
        if (stripped.length >= 4 && !isInvalidSingle) {
          city = stripped;
        }
        break;
      }
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

  // Saint -> St. normalization (cities DB uses "St.")
  city = city.replace(/\bSaint\s+/gi, 'St. ');

  // "St " -> "St. " (add missing period)
  city = city.replace(/\bSt\s+(?=[A-Z])/g, 'St. ');

  // Fond du Lac, King of Prussia, etc. (proper casing)
  city = city.replace(/\bDu\b/gi, 'du');
  city = city.replace(/\bDe\b/gi, 'de');
  city = city.replace(/\bOf\b/gi, 'of');

  // NY-specific normalizations
  if (state === 'NY') {
    if (city === 'New York' || city === 'Newyork') return 'New York City';
    if (city === 'Bronx') return 'The Bronx';
  }

  // CA-specific normalizations
  if (state === 'CA') {
    if (city === 'Big Bear') return 'Big Bear Lake';
    if (city === 'Toluca') return 'Toluca Lake';
    if (city === 'June') return 'June Lake';
  }

  // MI-specific normalizations
  if (state === 'MI') {
    if (city === 'Manitou Beach-Devils') return 'Manitou Beach';
    if (city === 'Whitmore') return 'Whitmore Lake';
    if (city === 'White') return 'White Lake';
  }

  // ND-specific normalizations (DB has "St Michael" without period)
  if (state === 'ND') {
    if (city === 'St. Michael') return 'St Michael';
    if (city === 'Devils' || city === 'Devil\'s') return 'Devils Lake';
  }

  // OH-specific normalizations
  if (state === 'OH') {
    if (city === 'St. Mary') return 'St. Marys';
    if (city === 'Canal') return 'Canal Fulton';
    if (city === 'Mentor On The' || city === 'Mentor On the') return 'Mentor-on-the-Lake';
    if (city === 'Buckeye') return 'Buckeye Lake';
    if (city === 'Upper') return 'Upper Arlington';
  }

  // MO-specific normalizations
  if (state === 'MO') {
    if (city === 'Saint Louis') return 'St. Louis';
    if (city === 'St Louis') return 'St. Louis';
    if (city === 'St Louis Park') return 'St. Louis';
    if (city === 'St Peters') return 'St. Peters';
    if (city === 'Lees' || city === 'Lee\'s') return 'Lee\'s Summit';
    if (city === 'Holts') return 'Holts Summit';
  }

  // FL-specific normalizations
  if (state === 'FL') {
    if (city === 'Saint Petersburg' || city === 'St Petersburg') return 'St. Petersburg';
    if (city === 'St Augustine') return 'St. Augustine';
    if (city === 'Fort') return 'Fort Myers';  // Most common
    if (city === 'West') return 'West Palm Beach';  // Most common
    if (city === 'Port') return 'Port St. Lucie';  // Most common
    if (city === 'Lady') return 'Lady Lake';
    if (city === 'Royal') return 'Royal Palm Beach';
  }

  // TX-specific normalizations
  if (state === 'TX') {
    if (city === 'Dfw Airport' || city === 'DFW Airport') return 'Dallas';
  }

  // MN-specific normalizations
  if (state === 'MN') {
    if (city === 'St Paul') return 'St. Paul';
    if (city === 'Saint Louis' || city === 'St Louis Park') return 'St. Louis Park';
    if (city === 'Forest') return 'Forest Lake';
    if (city === 'Prior') return 'Prior Lake';
  }

  // WA-specific normalizations
  if (state === 'WA') {
    if (city === 'Walla') return 'Walla Walla';
    if (city === 'Moses') return 'Moses Lake';
    if (city === 'Bonney') return 'Bonney Lake';
    if (city === 'Liberty') return 'Liberty Lake';
  }

  // PA-specific normalizations
  if (state === 'PA') {
    if (city === 'Clarks') return 'Clarks Summit';
    if (city === 'West') return 'West Chester';
  }

  // LA-specific normalizations
  if (state === 'LA') {
    if (city === 'West') return 'West Monroe';
  }

  // IN-specific normalizations
  if (state === 'IN') {
    if (city === 'Fort') return 'Fort Wayne';
  }

  // MS-specific normalizations
  if (state === 'MS') {
    if (city === 'Horn') return 'Horn Lake';
  }

  // WI-specific normalizations
  if (state === 'WI') {
    if (city === 'Rice') return 'Rice Lake';
    if (city === 'Camp') return 'Camp Douglas';
    if (city === 'Paddock') return 'Paddock Lake';
  }

  // IL-specific normalizations
  if (state === 'IL') {
    if (city === 'Crystal') return 'Crystal Lake';
    if (city === 'Island') return 'Island Lake';
    if (city === 'Third') return 'Third Lake';
    if (city === 'Wonder') return 'Wonder Lake';
    if (city === 'Round') return 'Round Lake';
  }

  // NJ-specific normalizations
  if (state === 'NJ') {
    if (city === 'Budd') return 'Budd Lake';
    if (city === 'East') return 'East Orange';
    if (city === 'West') return 'West Orange';
    if (city === 'North') return 'North Bergen';
  }

  // VT-specific normalizations
  if (state === 'VT') {
    if (city === 'South') return 'South Burlington';
  }

  // WV-specific normalizations
  if (state === 'WV') {
    if (city === 'South') return 'South Charleston';
  }

  // CO-specific normalizations
  if (state === 'CO') {
    if (city === 'Fort') return 'Fort Collins';
  }

  // MD-specific normalizations
  if (state === 'MD') {
    if (city === 'Fort') return 'Fort Washington';
  }

  // NC-specific normalizations
  if (state === 'NC') {
    if (city === 'Spring') return 'Spring Lake';
  }

  // IA-specific normalizations
  if (state === 'IA') {
    if (city === 'Clear') return 'Clear Lake';
    if (city === 'Storm') return 'Storm Lake';
    if (city === 'Spirit') return 'Spirit Lake';
  }

  // CT-specific normalizations
  if (state === 'CT') {
    if (city === 'West') return 'West Hartford';
    if (city === 'East') return 'East Hartford';
  }

  // UT-specific normalizations
  if (state === 'UT') {
    if (city === 'St George') return 'St. George';
  }

  // Ontario-specific normalizations (Toronto neighborhoods)
  if (state === 'ON') {
    if (city === 'Scarborough' || city === 'North York') return 'Toronto';
    if (city === 'St Catharines') return 'St. Catharines';
  }

  // Alberta-specific normalizations
  if (state === 'AB') {
    if (city === 'St Albert') return 'St. Albert';
    if (city === 'St Paul') return 'St. Paul';
  }

  // Quebec - Montreal variations
  if (state === 'QC') {
    if (city === 'Montréal' || city === 'Montreal') return 'Montréal';
    if (city === 'Québec' || city === 'Quebec') return 'Québec';
  }

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

console.log(`Extracting ${brandKey} from ${spiderName}${filterBrand ? ` (filtering for brand: ${filterBrand})` : ''}...`);

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
      // Filter by brand if specified (for shared spiders like exxon_mobil)
      if (filterBrand) {
        const brand = f.properties.brand || '';
        if (brand !== filterBrand) return false;
      }
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
