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
// Support extracted ATP folder (set ATP_DIR env var or use default)
const ATP_DIR = process.env.ATP_DIR || path.join(__dirname, '..', 'ATP2026-01-27', 'output');
const MANIFEST_FILE = path.join(__dirname, '..', 'manifest.json');
const ZIPCODE_FILE = path.join(__dirname, 'us-zipcodes.csv');

// Load ZIP code to city and state mapping
const zipcodeToCity = new Map();
const zipcodeToState = new Map();
try {
  const zipData = fs.readFileSync(ZIPCODE_FILE, 'utf-8');
  const lines = zipData.split('\n').slice(1); // Skip header
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 6) {
      const stateAbbr = parts[2];
      const zipcode = parts[3];
      const city = parts[5];
      if (zipcode && stateAbbr) {
        zipcodeToState.set(zipcode, stateAbbr);
      }
      if (zipcode && city && !city.startsWith('Zcta')) {
        zipcodeToCity.set(zipcode, city);
      }
    }
  }
  console.log(`Loaded ${zipcodeToCity.size} ZIP code mappings`);
} catch (err) {
  console.warn('Warning: Could not load ZIP code database:', err.message);
}

// Load city name aliases for normalizing "City County" format to just "City"
const CITY_ALIASES_FILE = '/Users/johnhanna/Documents/RoadVoice/data/city-name-aliases.json';
let cityAliases = {};
try {
  cityAliases = JSON.parse(fs.readFileSync(CITY_ALIASES_FILE, 'utf-8'));
  let aliasCount = 0;
  for (const state in cityAliases) {
    aliasCount += Object.keys(cityAliases[state]).length;
  }
  console.log(`Loaded ${aliasCount} city name aliases`);
} catch (err) {
  console.warn('Warning: Could not load city aliases:', err.message);
}

/**
 * Apply city alias to fix "City County" format
 */
function applyCityAlias(city, state) {
  if (!city || !state) return city;
  const stateAliases = cityAliases[state];
  if (!stateAliases) return city;

  const alias = stateAliases[city];
  if (alias === null) return ''; // null means remove (invalid city)
  if (alias) return alias;
  return city;
}

/**
 * Look up city from postal code
 */
function getCityFromPostcode(postcode) {
  if (!postcode) return '';
  // Normalize to 5-digit ZIP
  const zip5 = postcode.toString().replace(/[^0-9]/g, '').substring(0, 5);
  return zipcodeToCity.get(zip5) || '';
}

/**
 * Look up state from postal code
 */
function getStateFromPostcode(postcode) {
  if (!postcode) return '';
  // Normalize to 5-digit ZIP
  const zip5 = postcode.toString().replace(/[^0-9]/g, '').substring(0, 5);
  return zipcodeToState.get(zip5) || '';
}

/**
 * Extract property from ATP GeoJSON feature, trying multiple name variations
 */
function getProperty(props, ...keys) {
  for (const key of keys) {
    if (props[key]) return props[key];
  }
  return '';
}

/**
 * Check if a string looks like a hotel/resort name rather than a city name.
 * These sometimes appear in the city field in ATP data.
 */
function isHotelOrResortName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();

  // Keywords that indicate hotel/resort names
  const hotelKeywords = [
    'hotel', 'motel', 'inn ', ' inn', 'resort', 'lodge', 'suites', 'suite',
    'hyatt', 'marriott', 'hilton', 'sheraton', 'westin', 'alila', 'ritz',
    'four seasons', 'fairmont', 'intercontinental', 'holiday house',
    'spa ', ' spa', 'ranch ', ' ranch', 'campground', 'camping',
    'casa ', 'hacienda', 'villa ', 'villas', 'chateau', 'manor',
    'beach resort', 'golf course', 'country club',
    'the pearl', 'the bower', 'the estate', 'the laurel', 'the shay',
    'dream hollywood', 'gaige house', 'sparrows lodge', 'terra vita',
    'wild palms', 'pioneertown', 'mar monte', 'marina riviera',
    'apartments', 'byward market', 'the june', 'the walper', 'the wilfrid',
    'spirit ridge', 'under canvas', 'andaz ', 'elwood hotel', 'holston house',
    'ette hotel', 'siren hotel', 'bluebird cady', 'standard spa', 'xv beacon',
    'richard rindge', 'summercamp', 'salt house inn', 'christopher\'s by the bay',
    'awol', 'pell hotel', 'block island beach', 'lodge at spruce', 'park hyatt',
    'convention center', 'conference center', 'dunton town', 'vail residences',
    'austria haus', 'cheyenne mountain resort', 'fogo de',
    'rio all suite', 'palazzo', 'venetian', 'the row'
  ];

  for (const keyword of hotelKeywords) {
    if (lower.includes(keyword)) return true;
  }

  // Pattern: starts with "at " (like "at SFO", "at Anaheim Resort")
  if (lower.startsWith('at ')) return true;

  // Pattern: contains "in the" (like "Kissel Uptown Oakland - In the Unbound Collection")
  if (lower.includes(' in the ')) return true;

  return false;
}

/**
 * Check if a string is obviously not a valid city name
 */
function isInvalidCityName(name) {
  if (!name) return true;
  const lower = name.toLowerCase();

  // Too short to be a real city
  if (name.length < 2) return true;

  // Single word that's not a city (incomplete data)
  const invalidSingleWords = [
    'west', 'east', 'north', 'south', 'mount', 'mt', 'mt.', 'fort', 'ft', 'ft.',
    'lake', 'port', 'point', 'camp', 'china', 'city', 'downtown', 'airport',
    'county', 'area', 'region', 'center', 'central', 'plumas', 'shasta',
    'lax', 'sfo', 'jfk', 'ord', 'dfw', 'mia', 'sea', 'las', 'phx',
    'seaworld', 'disneyland', 'disneyworld'
  ];
  if (invalidSingleWords.includes(lower)) return true;

  // Patterns that indicate invalid data
  if (lower.startsWith('city of ') && lower.length < 12) return true;  // "City of" alone
  if (lower.startsWith('downtown ')) return true;  // "Downtown Sacramento"
  if (lower.endsWith(' area')) return true;  // "Sacramento Area"
  if (lower.endsWith(' county')) return true;  // "Orange County"
  if (lower.endsWith(' airport')) return true;  // "Los Angeles Airport"
  if (lower.endsWith(' california')) return true;  // "Rancho Cucamonga, California"
  if (lower.includes(' / ')) return true;  // "Ramona / Julian"
  if (lower.match(/^\d+\s/)) return true;  // Starts with number (address)
  if (lower.includes(' dr') || lower.includes(' rd') || lower.includes(' blvd') ||
      lower.includes(' ave') || lower.includes(' street')) return true;  // Contains street suffix
  if (lower.match(/\([^)]+\)$/)) return true;  // Ends with parenthetical like "Chula Vista (Eastlake)"

  return false;
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
  'Victoria', 'Kenosha', 'Waukesha', 'Yakima', 'Monterey', 'Jackson',
  // Additional Alabama counties
  'Autauga', 'Barbour', 'Bibb', 'Bullock', 'Chambers', 'Cherokee', 'Chilton',
  'Choctaw', 'Clarke', 'Clay', 'Cleburne', 'Coffee', 'Colbert', 'Conecuh',
  'Coosa', 'Covington', 'Crenshaw', 'Cullman', 'Dale', 'Dallas', 'Elmore',
  'Escambia', 'Geneva', 'Greene', 'Hale', 'Lamar', 'Lauderdale', 'Lawrence',
  'Lowndes', 'Macon', 'Marengo', 'Marshall', 'Perry', 'Pickens', 'Pike',
  'Randolph', 'Russell', 'Talladega', 'Tallapoosa', 'Walker', 'Wilcox', 'Winston',
  // Additional common county names from other states
  'Apache', 'Cochise', 'Coconino', 'Gila', 'Graham', 'Greenlee', 'Mohave',
  'Navajo', 'Pinal', 'Yavapai', 'Benton', 'Boone', 'Craighead', 'Crawford',
  'Crittenden', 'Faulkner', 'Garland', 'Lonoke', 'Miller', 'Poinsett', 'Pope',
  'Pulaski', 'Sebastian', 'White', 'Butte', 'Contra', 'Glenn', 'Humboldt',
  'Imperial', 'Inyo', 'Lassen', 'Marin', 'Mendocino', 'Merced', 'Modoc',
  'Napa', 'Nevada', 'Placer', 'Plumas', 'Shasta', 'Siskiyou', 'Solano',
  'Sonoma', 'Stanislaus', 'Sutter', 'Tehama', 'Trinity', 'Tulare', 'Tuolumne'
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

  // Convert ALL CAPS or all lowercase to proper case (Title Case)
  // This handles: "SACRAMENTO" -> "Sacramento", "san jose" -> "San Jose"
  if ((city === city.toUpperCase() || city === city.toLowerCase()) && city.length > 2) {
    city = city.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // Fix mixed case where some words are lowercase: "El cajon" -> "El Cajon"
  // Match any word that starts with lowercase and capitalize it
  city = city.replace(/\b([a-z])(\w*)/g, (match, first, rest) => first.toUpperCase() + rest);

  // Fix "Mc" capitalization (Mckinney -> McKinney, Mcallen -> McAllen)
  city = city.replace(/\bMc([a-z])/g, (match, letter) => 'Mc' + letter.toUpperCase());

  // Fix "La/Le/De" prefix capitalization when followed by capital (Lasalle -> LaSalle)
  city = city.replace(/\bLa([A-Z])/g, (match, letter) => 'La' + letter);
  city = city.replace(/\bLe([A-Z])/g, (match, letter) => 'Le' + letter);
  city = city.replace(/\bDe([A-Z])/g, (match, letter) => 'De' + letter);

  // Apply city aliases to fix "City County" format -> "City"
  city = applyCityAlias(city, state);
  if (!city) return ''; // alias returned empty = invalid city

  // Saint -> St. normalization (cities DB uses "St.")
  city = city.replace(/\bSaint\s+/gi, 'St. ');

  // "St " -> "St. " (add missing period)
  city = city.replace(/\bSt\s+(?=[A-Z])/g, 'St. ');

  // Fond du Lac, King of Prussia, etc. - lowercase articles/prepositions in middle of name
  // Only lowercase when NOT at the start of the name
  city = city.replace(/(.)\bDu\b/gi, (match, before) => before + 'du');
  city = city.replace(/(.)\bOf\b/gi, (match, before) => before + 'of');

  // Hyphenated names: lowercase articles/prepositions (Carmel-By-The-Sea -> Carmel-by-the-Sea)
  city = city.replace(/-By-/g, '-by-');
  city = city.replace(/-The-/g, '-the-');
  city = city.replace(/-On-/g, '-on-');
  city = city.replace(/-In-/g, '-in-');
  city = city.replace(/-Of-/g, '-of-');
  city = city.replace(/-At-/g, '-at-');

  // NY-specific normalizations
  if (state === 'NY') {
    if (city === 'New York' || city === 'Newyork') return 'New York City';
    if (city === 'Bronx') return 'The Bronx';
  }

  // AZ-specific normalizations
  if (state === 'AZ') {
    if (city === 'Ft. Huachuca') return 'Fort Huachuca';
    if (city === 'Greenvalley') return 'Green Valley';
    if (city === 'Huachuca City,') return 'Huachuca City';
    if (city === 'Lake Havasu Cty') return 'Lake Havasu City';
    if (city === 'Pheonix') return 'Phoenix';
    if (city === 'Prescott,') return 'Prescott';
    if (city === 'Queens Creek') return 'Queen Creek';
    if (city === 'St. David') return 'Saint David';
    if (city === 'St. Johns') return 'Saint Johns';
    if (city === 'St. Michaels') return 'Saint Michaels';
  }

  // CA-specific normalizations
  if (state === 'CA') {
    if (city === 'Bakerfield') return 'Bakersfield';
    if (city === 'Big Bear') return 'Big Bear Lake';
    if (city === 'Toluca') return 'Toluca Lake';
    if (city === 'June' || city === 'June Lake,') return 'June Lake';
    if (city === 'Mt.' || city === 'Mt') return 'Mt. Shasta';
    if (city === '29 Palms') return 'Twentynine Palms';
    if (city === 'Twenty-Nine Palms') return 'Twentynine Palms';
    if (city === 'Camp Pendelton') return 'Camp Pendleton';
    if (city === 'Cathedral Cty') return 'Cathedral City';
    if (city === 'Clearlake Oaks') return 'Clear Lake Oaks';
    if (city === 'Desert Hot Sprngs') return 'Desert Hot Springs';
    if (city === 'E Los Angeles') return 'East Los Angeles';
    if (city === 'La Canada Flintridge') return 'La Cañada Flintridge';
    if (city === 'Lahabra') return 'La Habra';
    if (city === 'Lamirada') return 'La Mirada';
    if (city === 'N Hollywood' || city === 'N. Hollywood') return 'North Hollywood';
    if (city === 'Quartzhill') return 'Quartz Hill';
    if (city === 'Redondo Bch.') return 'Redondo Beach';
    if (city === 'Rncho Snta Margarita') return 'Rancho Santa Margarita';
    if (city === 'Rolling Hills Estate') return 'Rolling Hills Estates';
    if (city === 'S Los Angeles') return 'South Los Angeles';
    if (city === 'S. Pasadena') return 'South Pasadena';
    if (city === 'S. San Francisco') return 'South San Francisco';
    if (city === 'Sacramento,') return 'Sacramento';
    if (city === 'Shasta Lake City') return 'Shasta Lake';
    if (city === 'St. Helena') return 'Saint Helena';
    if (city === 'Suisun City') return 'Suisun';
    if (city === 'W Merced') return 'West Merced';
    if (city === 'Bell,') return 'Bell';
    if (city === 'Windsor,') return 'Windsor';
  }

  // MI-specific normalizations
  if (state === 'MI') {
    if (city === 'Manitou Beach-Devils') return 'Manitou Beach';
    if (city === 'Whitmore') return 'Whitmore Lake';
    if (city === 'White') return 'White Lake';
    if (city === 'Centerline') return 'Center Line';
    if (city === 'De Tour Village') return 'DeTour Village';
    if (city === 'De Witt') return 'DeWitt';
    if (city === 'Houghton Lake Heights') return 'Houghton Lake';
    if (city === 'Hree Rivers') return 'Three Rivers';
    if (city === 'Mt Pleasant') return 'Mount Pleasant';
    if (city === 'Sault Ste. Marie') return 'Sault Sainte Marie';
    if (city === 'St Joseph' || city === 'St. Joseph') return 'Saint Joseph';
    if (city === 'St. Charles') return 'Saint Charles';
    if (city === 'St. Clair') return 'Saint Clair';
    if (city === 'St. Clair Shores') return 'Saint Clair Shores';
    if (city === 'St. Helen') return 'Saint Helen';
    if (city === 'St. Ignace') return 'Saint Ignace';
    if (city === 'St. Johns') return 'Saint Johns';
    if (city === 'St. Louis') return 'Saint Louis';
    if (city === 'W Bloomfield') return 'West Bloomfield';
    if (city === 'Gaylord..') return 'Gaylord';
    if (city === 'Canton Twp' || city === 'Canton Township') return 'Canton';
    if (city === 'Chesterfield Twp' || city === 'Chesterfield Townshi') return 'Chesterfield';
    if (city === 'Clinton Township') return 'Clinton';
    if (city === 'Commerce Twp' || city === 'Commerce Township') return 'Commerce';
    if (city === 'Macomb Twp.' || city === 'Macomb Township') return 'Macomb';
    if (city === 'Redford Twp' || city === 'Redford Township') return 'Redford';
    if (city === 'Shelby Township') return 'Shelby';
    if (city === 'Waterford Twp' || city === 'Waterford Twp.') return 'Waterford';
    if (city === 'White Lake Township') return 'White Lake';
    if (city === 'Wyoming, Mi') return 'Wyoming';
    if (city === 'Battle Creek, Mi') return 'Battle Creek';
  }

  // ND-specific normalizations (DB has "St Michael" without period)
  if (state === 'ND') {
    if (city === 'St. Michael') return 'St Michael';
    if (city === 'Devils' || city === 'Devil\'s' || city === "Devil's Lake") return 'Devils Lake';
    if (city === 'Bismark') return 'Bismarck';
  }

  // AK-specific normalizations
  if (state === 'AK') {
    if (city === 'St. Michael') return 'Saint Michael';
  }

  // AR-specific normalizations
  if (state === 'AR') {
    if (city === 'De Valls Bluff') return 'DeValls Bluff';
    if (city === 'De Witt') return 'DeWitt';
    if (city === 'Dequeen') return 'De Queen';
    if (city === 'Eldorado') return 'El Dorado';
    if (city === 'Heber Spgs') return 'Heber Springs';
    if (city === 'Jacksonsville') return 'Jacksonville';
    if (city === 'Mammoth Springs') return 'Mammoth Spring';
    if (city === 'Mc Crory') return 'McCrory';
    if (city === 'N Little Rock' || city === 'N. Little Rock') return 'North Little Rock';
    if (city === 'Baldknob') return 'Bald Knob';
    if (city === 'St. Joe') return 'Saint Joe';
    if (city === 'St. Paul') return 'Saint Paul';
  }

  // TN-specific normalizations
  if (state === 'TN') {
    if (city === 'Chattanoooga') return 'Chattanooga';
    if (city === 'Moristown') return 'Morristown';
    if (city === 'Lafollette') return 'La Follette';
    if (city === 'Lavergne') return 'La Vergne';
    if (city === 'Mc Ewen') return 'McEwen';
    if (city === 'Mc Kenzie') return 'McKenzie';
    if (city === 'Mt Juliet' || city === 'Mt. Juliet') return 'Mount Juliet';
    if (city === 'Mt Pleasant' || city === 'Mt. Pleasant') return 'Mount Pleasant';
    if (city === 'Ootlewah') return 'Ooltewah';
    if (city === 'S Pittsburg') return 'South Pittsburg';
    if (city === "Thompson's Station") return 'Thompsons Station';
    if (city === 'St. Joseph') return 'Saint Joseph';
  }

  // VT-specific normalizations
  if (state === 'VT') {
    if (city === 'South') return 'South Burlington';
    if (city === 'St. Albans' || city === 'St. Albans City' || city === 'St. Albans Town') return 'Saint Albans';
    if (city === 'St. Johnsbury') return 'Saint Johnsbury';
    if (city === 'White River Jct') return 'White River Junction';
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

  // FL-specific normalizations (DB uses "Saint" not "St.")
  if (state === 'FL') {
    if (city === 'St Petersburg' || city === 'St. Petersburg' || city === 'St.Petersburg') return 'Saint Petersburg';
    if (city === 'St Augustine' || city === 'St. Augustine' || city === 'St.Augustine') return 'Saint Augustine';
    if (city === 'St. Augustine Beach' || city === 'St Augustine Beach') return 'Saint Augustine Beach';
    if (city === 'St Cloud' || city === 'St. Cloud') return 'Saint Cloud';
    if (city === 'St. Pete Beach' || city === 'St Pete Beach') return 'Saint Pete Beach';
    if (city === 'St. Marks' || city === 'St Marks') return 'Saint Marks';
    if (city === 'St. Johns' || city === 'St Johns' || city === 'St. John') return 'Saint Johns';
    if (city === 'St. George Island' || city === 'St George Island') return 'Saint George Island';
    if (city === 'St. James City' || city === 'St James City') return 'Saint James City';
    if (city === 'Ft Lauderdale' || city === 'Ft. Lauderdale' || city === 'Ft.Lauderdale') return 'Fort Lauderdale';
    if (city === 'Ft Myers' || city === 'Ft. Myers') return 'Fort Myers';
    if (city === 'Ft Pierce' || city === 'Ft. Pierce') return 'Fort Pierce';
    if (city === 'Ft Walton Beach' || city === 'Ft. Walton Beach' || city === 'Ft Walton Bch') return 'Fort Walton Beach';
    if (city === 'N. Lauderdale' || city === 'N Lauderdale') return 'North Lauderdale';
    if (city === 'N. Miami' || city === 'N Miami') return 'North Miami';
    if (city === 'N. Margate') return 'Margate';
    if (city === 'W Palm Beach') return 'West Palm Beach';
    if (city === 'Cheifland') return 'Chiefland';
    if (city === 'Coral Spings' || city === 'Coral Spring') return 'Coral Springs';
    if (city === 'Deerfield Bch') return 'Deerfield Beach';
    if (city === 'Green Cove Spring') return 'Green Cove Springs';
    if (city === 'Hallandale') return 'Hallandale Beach';
    if (city === 'Jacksonsville') return 'Jacksonville';
    if (city === 'Lake Worth') return 'Lake Worth Beach';
    if (city === 'Satellite Bch') return 'Satellite Beach';
    if (city === 'St. Petesburg') return 'Saint Petersburg';
    if (city === 'Tavenier') return 'Tavernier';
    if (city === 'Altamonte Spg' || city === 'Altamonte Spri Gs') return 'Altamonte Springs';
    if (city === 'Mt Dora') return 'Mount Dora';
    if (city === 'Deland' || city === 'De Land') return 'DeLand';
    if (city === 'Defuniak Spg' || city === 'Defuniak Springs') return 'DeFuniak Springs';
    if (city === 'Fort') return 'Fort Myers';
    if (city === 'West') return 'West Palm Beach';
    if (city === 'Port') return 'Port St. Lucie';
    if (city === 'Lady') return 'Lady Lake';
    if (city === 'Royal') return 'Royal Palm Beach';
  }

  // TX-specific normalizations
  if (state === 'TX') {
    if (city === 'Dfw Airport' || city === 'DFW Airport') return 'Dallas';
  }

  // MN-specific normalizations
  if (state === 'MN') {
    if (city === 'St Paul' || city === 'St. Paul' || city === 'St.Paul') return 'Saint Paul';
    if (city === 'Saint Louis' || city === 'St Louis Park' || city === 'St. Louis Park' || city === 'St.Louis Park') return 'Saint Louis Park';
    if (city === 'Forest') return 'Forest Lake';
    if (city === 'Prior') return 'Prior Lake';
    if (city === 'Hutchinsonn') return 'Hutchinson';
    if (city === 'Lesueur') return 'Le Sueur';
    if (city === 'N St. Paul' || city === 'North St. Paul') return 'North Saint Paul';
    if (city === 'South St. Paul') return 'South Saint Paul';
    if (city === 'W St. Paul' || city === 'West St. Paul') return 'West Saint Paul';
    if (city === 'Marine On St. Croix') return 'Marine on Saint Croix';
    if (city === 'Lake St. Croix Beach') return 'Lake Saint Croix Beach';
    if (city === 'St Cloud' || city === 'St. Cloud') return 'Saint Cloud';
    if (city === 'St. Anthony') return 'Saint Anthony';
    if (city === 'St. Augusta') return 'Saint Augusta';
    if (city === 'St. Bonifacius') return 'Saint Bonifacius';
    if (city === 'St. Charles') return 'Saint Charles';
    if (city === 'St. Clair') return 'Saint Clair';
    if (city === 'St. Francis') return 'Saint Francis';
    if (city === 'St. James') return 'Saint James';
    if (city === 'St. Joseph') return 'Saint Joseph';
    if (city === 'St. Michael') return 'Saint Michael';
    if (city === 'St. Peter') return 'Saint Peter';
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
    if (city === 'Fort' || city === 'Ft Wayne' || city === 'Ft. Wayne') return 'Fort Wayne';
    if (city === 'Indianpolis' || city === 'Indianapollis') return 'Indianapolis';
    if (city === 'Lacrosse') return 'La Crosse';
    if (city === 'Lagrange') return 'LaGrange';
    if (city === 'Laporte') return 'La Porte';
    if (city === 'Mt. Vernon') return 'Mount Vernon';
    if (city === 'N Manchester') return 'North Manchester';
    if (city === 'Poratage') return 'Portage';
    if (city === 'Rolling Prarie') return 'Rolling Prairie';
    if (city === 'St. Anthony') return 'Saint Anthony';
    if (city === 'St. John' || city === 'St.John') return 'Saint John';
    if (city === 'St. Meinrad') return 'Saint Meinrad';
    if (city === 'St. Paul') return 'Saint Paul';
    if (city === 'W Lafayette') return 'West Lafayette';
    if (city === 'W Terre Haute') return 'West Terre Haute';
    if (city === 'Valparaiso,') return 'Valparaiso';
  }

  // MS-specific normalizations
  if (state === 'MS') {
    if (city === 'Horn') return 'Horn Lake';
    if (city === 'Bay St. Louis') return 'Bay Saint Louis';
    if (city === 'Diberville' || city === "D'Iberville") return "D'Iberville";
    if (city === 'Dekalb') return 'DeKalb';
    if (city === 'Luka') return 'Iuka';
    if (city === 'Robinsville') return 'Robinsonville';
    if (city === 'Southhaven') return 'Southaven';
  }

  // WI-specific normalizations
  if (state === 'WI') {
    if (city === 'Rice') return 'Rice Lake';
    if (city === 'Camp') return 'Camp Douglas';
    if (city === 'Paddock') return 'Paddock Lake';
    if (city === 'De Forest') return 'DeForest';
    if (city === 'Depere') return 'De Pere';
    if (city === 'Fond Du Loc') return 'Fond du Lac';
    if (city === 'Lacrosse') return 'La Crosse';
    if (city === 'Mc Farland') return 'McFarland';
    if (city === 'Milwakee') return 'Milwaukee';
    if (city === 'Mt Horeb') return 'Mount Horeb';
    if (city === 'S Beloit') return 'South Beloit';
    if (city === 'St. Cloud') return 'Saint Cloud';
    if (city === 'St. Croix Falls') return 'Saint Croix Falls';
    if (city === 'St. Francis') return 'Saint Francis';
    if (city === 'St. Germain') return 'Saint Germain';
    if (city === 'Westbend') return 'West Bend';
    if (city === 'Ashwaubenon,') return 'Ashwaubenon';
    if (city === 'Oshkosh,') return 'Oshkosh';
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

  // WV-specific normalizations
  if (state === 'WV') {
    if (city === 'South') return 'South Charleston';
  }

  // CO-specific normalizations
  if (state === 'CO') {
    if (city === 'Fort' || city === 'Ft Collins') return 'Fort Collins';
    if (city === 'Bouler') return 'Boulder';
    if (city === 'Colordao Spings') return 'Colorado Springs';
    if (city === 'Dacano') return 'Dacono';
    if (city === 'Debeque') return 'De Beque';
    if (city === 'Lonetree') return 'Lone Tree';
  }

  // KS-specific normalizations
  if (state === 'KS') {
    if (city === 'Desoto') return 'De Soto';
    if (city === 'Ft Leavenworth') return 'Fort Leavenworth';
    if (city === 'Ft. Riley') return 'Fort Riley';
    if (city === 'Ft. Scott') return 'Fort Scott';
    if (city === 'Rosehill') return 'Rose Hill';
    if (city === 'Springhill') return 'Spring Hill';
    if (city === 'St. Francis') return 'Saint Francis';
    if (city === 'St. John') return 'Saint John';
    if (city === 'St. Marys') return 'Saint Marys';
    if (city === 'St. Paul') return 'Saint Paul';
    if (city === 'Wa Keeney') return 'WaKeeney';
    if (city === 'Wichita.') return 'Wichita';
  }

  // KY-specific normalizations
  if (state === 'KY') {
    if (city === 'E Bernstadt') return 'East Bernstadt';
    if (city === 'Erlinger') return 'Erlanger';
    if (city === 'Florence,') return 'Florence';
    if (city === 'Ft Knox') return 'Fort Knox';
    if (city === 'Ft Mitchell' || city === 'Ft. Mitchell') return 'Fort Mitchell';
    if (city === 'Ft Wright') return 'Fort Wright';
    if (city === 'Ft.Campbell') return 'Fort Campbell';
    if (city === 'La Center') return 'LaCenter';
    if (city === 'Lagrange') return 'La Grange';
    if (city === 'Middlesborough') return 'Middlesboro';
    if (city === 'Mt Sterling' || city === 'Mt. Sterling') return 'Mount Sterling';
    if (city === 'Mt Washington' || city === 'Mt. Washington') return 'Mount Washington';
    if (city === "Smith's Grove") return 'Smiths Grove';
    if (city === 'St. Charles') return 'Saint Charles';
    if (city === 'St. Matthews') return 'Saint Matthews';
  }

  // MD-specific normalizations
  if (state === 'MD') {
    if (city === 'Fort') return 'Fort Washington';
    if (city === 'Ft. Meade') return 'Fort Meade';
    if (city === 'Ft. Washington') return 'Fort Washington';
    if (city === 'Camp Spring') return 'Camp Springs';
    if (city === 'Captiol Heights') return 'Capitol Heights';
    if (city === 'Ellicot City') return 'Ellicott City';
    if (city === 'Hyatsville') return 'Hyattsville';
    if (city === 'Laplata') return 'La Plata';
    if (city === 'Mc Henry') return 'McHenry';
    if (city === 'Smithburg') return 'Smithsburg';
    if (city === 'St. Leonard') return 'Saint Leonard';
    if (city === 'St. Michaels') return 'Saint Michaels';
    if (city === 'W Ocean City') return 'West Ocean City';
    if (city === 'Prince Frederick,') return 'Prince Frederick';
  }

  // MA-specific normalizations
  if (state === 'MA') {
    if (city === 'Foxborough' || city === 'Foxborough (Foxboro)') return 'Foxboro';
    if (city === 'Lanesborough') return 'Lanesboro';
    if (city === 'Marlborough') return 'Marlboro';
    if (city === 'Middleborough') return 'Middleboro';
    if (city === 'North Attleborough') return 'North Attleboro';
    if (city === 'Northborough') return 'Northboro';
    if (city === 'Plainvile') return 'Plainville';
    if (city === 'Southborough') return 'Southboro';
    if (city === 'Tyngsborough') return 'Tyngsboro';
    if (city === 'Westborough') return 'Westboro';
    if (city === 'Natick,') return 'Natick';
  }

  // NC-specific normalizations
  if (state === 'NC') {
    if (city === 'Spring') return 'Spring Lake';
    if (city === 'W.T. Harris Blvd') return 'Charlotte';
  }

  // IA-specific normalizations
  if (state === 'IA') {
    if (city === 'Clear' || city === 'Clearlake') return 'Clear Lake';
    if (city === 'Storm') return 'Storm Lake';
    if (city === 'Spirit') return 'Spirit Lake';
    if (city === 'Desoto') return 'De Soto';
    if (city === 'Leclaire') return 'LeClaire';
    if (city === 'Lemars') return 'Le Mars';
    if (city === 'Mt Pleasant' || city === 'Mt. Vernon') return 'Mount Pleasant';
    if (city === 'St Ansgar' || city === 'St. Ansgar') return 'Saint Ansgar';
    if (city === 'St Charles' || city === 'St. Charles') return 'Saint Charles';
    if (city === 'St Lucas') return 'Saint Lucas';
    if (city === 'Lonetree') return 'Lone Tree';
  }

  // CT-specific normalizations
  if (state === 'CT') {
    if (city === 'West') return 'West Hartford';
    if (city === 'East') return 'East Hartford';
  }

  // UT-specific normalizations
  if (state === 'UT') {
    if (city === 'St George' || city === 'St. George') return 'Saint George';
    if (city === 'Laverkin') return 'LaVerkin';
    if (city === 'Marriot-Slaterville' || city === 'Marriott Slaterville') return 'Marriott-Slaterville';
    if (city === 'Mt. Pleasant') return 'Mount Pleasant';
    if (city === 'S Salt Lake') return 'South Salt Lake';
    if (city === 'Spanish Fork (Spanis') return 'Spanish Fork';
    if (city === 'Washington City') return 'Washington';
    if (city === 'West Valley Cit') return 'West Valley City';
  }

  // NV-specific normalizations
  if (state === 'NV') {
    if (city === 'N Las Vegas') return 'North Las Vegas';
    if (city === 'South Lake Tahoe') return 'Lake Tahoe';
  }

  // NH-specific normalizations
  if (state === 'NH') {
    if (city === 'Center Conway') return 'Conway';
    if (city === 'Center Ossipee') return 'Ossipee';
    if (city === 'East Hampstead') return 'Hampstead';
    if (city === 'North Conway') return 'Conway';
    if (city === 'North Haverhill') return 'Haverhill';
    if (city === 'North Swanzey') return 'Swanzey';
    if (city === 'South Weare') return 'Weare';
    if (city === 'West Chesterfield') return 'Chesterfield';
    if (city === 'West Lebanon') return 'Lebanon';
    if (city === 'West Ossipee') return 'Ossipee';
    if (city === 'West Swanzey') return 'Swanzey';
  }

  // WV-specific normalizations
  if (state === 'WV') {
    if (city === 'Kanawha Ciy') return 'Kanawha City';
    if (city === 'Mineralwells') return 'Mineral Wells';
    if (city === 'Mt Hope') return 'Mount Hope';
    if (city === 'Nutterfort') return 'Nutter Fort';
    if (city === 'Phillipi') return 'Philippi';
    if (city === 'S Charleston') return 'South Charleston';
    if (city === 'Slatyfork') return 'Slatyfork';
    if (city === 'St. Albans') return 'Saint Albans';
    if (city === "St. Mary's" || city === 'St. Marys') return 'Saint Marys';
    if (city === 'White Hall') return 'Whitehall';
  }

  // ME-specific normalizations
  if (state === 'ME') {
    if (city === 'Augusta, Me') return 'Augusta';
    if (city === 'N Berwick') return 'North Berwick';
    if (city === 'N Waterboro') return 'North Waterboro';
    if (city === 'St. Albans') return 'Saint Albans';
  }

  // MT-specific normalizations
  if (state === 'MT') {
    if (city === 'Big Fork') return 'Bigfork';
    if (city === 'St. Ignatius') return 'Saint Ignatius';
    if (city === 'St. Regis') return 'Saint Regis';
  }

  // WY-specific normalizations
  if (state === 'WY') {
    if (city === 'Casper (W)') return 'Casper';
    if (city === 'Ft. Bridger') return 'Fort Bridger';
    if (city === 'Laramie Wyoming') return 'Laramie';
    if (city === 'Mt. View') return 'Mountain View';
  }

  // RI-specific normalizations
  if (state === 'RI') {
    if (city === 'E Providence') return 'East Providence';
    if (city === 'N Smithfield') return 'North Smithfield';
  }

  // NE-specific normalizations
  if (state === 'NE') {
    if (city === 'Ft. Calhoun') return 'Fort Calhoun';
    if (city === 'O Neill') return "O'Neill";
    if (city === 'St. Paul') return 'Saint Paul';
  }

  // Ontario-specific normalizations (Toronto neighborhoods and city variations)
  if (state === 'ON') {
    if (city === 'Scarborough' || city === 'North York') return 'Toronto';
    if (city === 'Barrhaven' || city === 'Orleans' || city === 'Orléans') return 'Ottawa';
    if (city === 'St Catharines' || city === 'Saint Catharines') return 'St. Catharines';
    if (city === 'St Thomas' || city === 'Saint Thomas') return 'St. Thomas';
    if (city === 'Sudbury') return 'Greater Sudbury';
    if (city === 'Bradford') return 'Bradford West Gwillimbury';
    if (city === 'Rockland') return 'Clarence-Rockland';
  }

  // Alberta-specific normalizations
  if (state === 'AB') {
    if (city === 'St Albert' || city === 'St. Albert') return 'Saint Albert';
    if (city === 'St Paul' || city === 'St. Paul') return 'Saint Paul';
    if (city === 'Lac La Biche') return 'Lac La Biche County';
    if (city === 'Rocky View') return 'Rocky View County';
  }

  // British Columbia-specific normalizations
  if (state === 'BC') {
    if (city === 'Westbank') return 'West Kelowna';  // Renamed in 2007
  }

  // Newfoundland-specific normalizations
  if (state === 'NL') {
    if (city === "St. John's" || city === "St John's" || city === 'St Johns') return "Saint John's";
  }

  // AL-specific normalizations (fix typos in ATP data)
  if (state === 'AL') {
    if (city === 'Madsion') return 'Madison';
    if (city === 'Henager') return 'Henagar';
    if (city === 'Hunstville') return 'Huntsville';
    if (city === 'Bayou la Batre' || city === 'Bayou Labatre') return 'Bayou La Batre';
    if (city === 'Dixon Mills') return 'Dixons Mills';
    if (city === 'Eufala') return 'Eufaula';
    if (city === 'Laceys Spring') return 'Lacey Springs';
    if (city === 'Lakeview') return 'Lake View';
    if (city === 'Montomery') return 'Montgomery';
    if (city === 'Norhtport') return 'Northport';
    if (city === 'Owens Crossroads') return 'Owens Cross Roads';
    if (city === 'Pell') return 'Pell City';
    if (city === 'Pleasant Groves') return 'Pleasant Grove';
    if (city === 'Prattvile' || city === 'Pratville') return 'Prattville';
    if (city === 'Rainesville') return 'Rainsville';
    if (city === 'Saraland,') return 'Saraland';
    if (city === 'Smith Station') return 'Smiths Station';
    if (city === 'Tucaloosa') return 'Tuscaloosa';
    if (city === 'test' || city === 'Test') return '';  // filter out test data
    if (city === 'Ft. Novosel' || city === 'Ft Novosel') return 'Fort Novosel';
    if (city === 'G Hoover') return 'Hoover';
    if (city === 'Mc Calla') return 'McCalla';
    if (city === 'Town of Pike Road') return 'Pike Road';
    if (city === 'Tuskegee Institute') return 'Tuskegee';
    if (city === 'Pelham (Birmingham)') return 'Pelham';
  }

  // LA-specific normalizations
  if (state === 'LA') {
    if (city === 'Gonzalez') return 'Gonzales';
    if (city === 'Barksdale Air Force Base') return 'Barksdale AFB';
    if (city === 'Laplace' || city === 'La place') return 'LaPlace';
  }

  // DC-specific normalizations (fix hotel names in city field)
  if (state === 'DC') {
    if (city.startsWith('Thompson Washington')) return 'Washington';
  }

  // GA-specific normalizations
  if (state === 'GA') {
    if (city === "Saint Simon's Island" || city === "St. Simon's Island" ||
        city === 'St Simons Is' || city === 'St. Simons' || city === 'Saint Simons') {
      return 'Saint Simons Island';
    }
    if (city === 'Alpheretta') return 'Alpharetta';
    if (city === 'Tocooa') return 'Toccoa';
    if (city === 'Bryon') return 'Byron';
    if (city === 'Warner Robbins' || city === 'Warner-Robins') return 'Warner Robins';
    if (city === 'Carralton') return 'Carrollton';
    if (city === 'Mc Caysville') return 'McCaysville';
    if (city === 'Mc Rae') return 'McRae';
    if (city === 'McRae Helena') return 'McRae-Helena';
    if (city === 'St. Simons Island' || city === 'St Simons Island') return 'Saint Simons Island';
    if (city === 'St. Mary' || city === 'St Mary' || city === 'Saint Mary') return 'St. Marys';
  }

  // SC-specific normalizations
  if (state === 'SC') {
    if (city === 'N Augusta' || city === 'N. Augusta') return 'North Augusta';
    if (city === "Lady's Island") return 'Ladys Island';
  }

  // NC-specific normalizations
  if (state === 'NC') {
    if (city === 'Ashboro') return 'Asheboro';
    if (city === 'Fuquay') return 'Fuquay-Varina';
    if (city === 'Fort Mills') return 'Fort Mill';
    if (city === 'Mt Pleasant' || city === 'Mt. Pleasant') return 'Mount Pleasant';
    if (city === 'N Topsail Beach' || city === 'N. Topsail Beach') return 'North Topsail Beach';
    if (city === 'Winston -Salem' || city === 'Winston- Salem' || city === 'Winston Salem') return 'Winston-Salem';
  }

  // TX-specific normalizations
  if (state === 'TX') {
    if (city === 'Bee Caves') return 'Bee Cave';
    if (city === 'Deerpark') return 'Deer Park';
    if (city === 'Gerogetown') return 'Georgetown';
    if (city === 'Halletsville') return 'Hallettsville';
    if (city === 'Kileen') return 'Killeen';
    if (city === 'Leaque City') return 'League City';
    if (city === 'Mt Belveiu' || city === 'Mt. Belvieu' || city === 'Mount Belveiu') return 'Mont Belvieu';
    if (city === 'Prarie View') return 'Prairie View';
    if (city === 'China Spring') return 'China Springs';
    if (city === 'Van Veleck') return 'Van Vleck';
  }

  // PA-specific normalizations
  if (state === 'PA') {
    if (city === 'Dicksoncity') return 'Dickson City';
    if (city === 'Jeanette') return 'Jeannette';
    if (city === 'Emmaus' || city === 'Emaus') return 'Emmaus';
    if (city === 'E-town' || city === 'E-Town') return 'Elizabethtown';
    if (city === 'Mc Sherrystown') return 'McSherrystown';
    if (city === 'N Versailles' || city === 'N. Versailles') return 'North Versailles';
    if (city === 'N Huntingdon' || city === 'N. Huntingdon') return 'North Huntingdon';
    if (city === 'Cranberry Twp' || city === 'Cranberry Twp.') return 'Cranberry Township';
    if (city === 'Ross Twp' || city === 'Ross Twp.') return 'Ross Township';
    if (city === 'Scott Twp' || city === 'Scott Twp.') return 'Scott Township';
    if (city === 'Hanover Twp' || city === 'Hanover Twp.') return 'Hanover Township';
    if (city === 'Mt. Airy') return 'Mount Airy';
    if (city === 'Mt. Penn') return 'Mount Penn';
  }

  // NY-specific normalizations
  if (state === 'NY') {
    if (city === 'Averne') return 'Arverne';
    if (city === 'Brumswick') return 'Brunswick';
    if (city === 'Castleton On' || city === 'Castleton on') return 'Castleton-on-Hudson';
    if (city === 'Croton' || city === 'Croton On' || city === 'Croton on') return 'Croton-on-Hudson';
    if (city === 'E Meadow' || city === 'E. Meadow') return 'East Meadow';
    if (city === 'E Northport' || city === 'E. Northport') return 'East Northport';
    if (city === 'Hasting') return 'Hastings-on-Hudson';
    if (city === 'Port Jefferson Stati' || city === 'Port Jefferson Stn') return 'Port Jefferson Station';
    if (city === 'Rockville Ctr' || city === 'Rockville Ctr.') return 'Rockville Centre';
    if (city === 'S Farmingdale' || city === 'S. Farmingdale') return 'South Farmingdale';
    if (city === 'S Ozone Park' || city === 'S. Ozone Park') return 'South Ozone Park';
    if (city === 'S Richmond Hill' || city === 'S. Richmond Hill') return 'South Richmond Hill';
    if (city === 'Saratoga Spgs' || city === 'Saratoga Spgs.') return 'Saratoga Springs';
    if (city === 'Wappinger Falls') return 'Wappingers Falls';
    if (city === 'Wyndanch') return 'Wyandanch';
    if (city === 'NYC' || city === 'Nyc') return 'New York';
  }

  // NJ-specific normalizations
  if (state === 'NJ') {
    if (city === 'E Brunswick' || city === 'E. Brunswick') return 'East Brunswick';
    if (city === 'E Rutherford' || city === 'E. Rutherford') return 'East Rutherford';
    if (city === 'E Windsor' || city === 'E. Windsor') return 'East Windsor';
    if (city === 'N Brunswick' || city === 'N. Brunswick') return 'North Brunswick';
    if (city === 'Kearney') return 'Kearny';
    if (city === 'Passiac') return 'Passaic';
    if (city === 'Princeton Jct' || city === 'Princeton Jct.') return 'Princeton Junction';
    if (city === 'Saddlebrook') return 'Saddle Brook';
    if (city === 'West Patterson') return 'West Paterson';
    if (city === 'Woodcliff') return 'Woodcliff Lake';
    if (city === 'Egg Hbr Twp' || city === 'Egg Harbor Twsp' || city === 'Egg Harbor Twsp.') return 'Egg Harbor Township';
    if (city === 'Mt Laurel Twp' || city === 'Mt Laurel Township' || city === 'Mt. Laurel Township') return 'Mount Laurel Township';
    if (city === 'Green Brook Twp' || city === 'Green Brook Twp.') return 'Green Brook Township';
    if (city === 'Ocean Twp' || city === 'Ocean Twp.') return 'Ocean Township';
    if (city === 'Monroe Twp' || city === 'Monroe Twp.') return 'Monroe Township';
    if (city === 'Hamilton Twp' || city === 'Hamilton Twp.') return 'Hamilton Township';
    if (city === 'Ewing Twp' || city === 'Ewing Twp.') return 'Ewing Township';
    if (city === 'Evesham Twp' || city === 'Evesham Twp.') return 'Evesham Township';
    if (city === 'Hazlet Twsp' || city === 'Hazlet Twsp.') return 'Hazlet Township';
  }

  // CT-specific normalizations
  if (state === 'CT') {
    if (city === 'W Hartford' || city === 'W. Hartford') return 'West Hartford';
    if (city === 'Stafford Springs') return 'Stafford';
    if (city === 'Mansfield Center') return 'Mansfield';
    if (city === 'Pomfret Center') return 'Pomfret';
    if (city === 'Killingworth Village') return 'Killingworth';
    if (city === 'Woodstock Valley') return 'Woodstock';
  }

  // MO-specific normalizations
  if (state === 'MO') {
    if (city === 'Lee Summit' || city === 'Lees Summit') return "Lee's Summit";
    if (city === 'St.Louis' || city === 'St.louis') return 'St. Louis';
  }

  // OH-specific normalizations
  if (state === 'OH') {
    if (city === 'Beford') return 'Bedford';
    if (city === 'Beaver Creek') return 'Beavercreek';
    if (city === 'Beaver Dam') return 'Beaverdam';
    if (city === 'E Liverpool' || city === 'E. Liverpool') return 'East Liverpool';
    if (city === 'Maysvile') return 'Maysville';
    if (city === 'Mt Orab' || city === 'Mt. Orab') return 'Mount Orab';
    if (city === 'Mt Eaton' || city === 'Mt. Eaton') return 'Mount Eaton';
    if (city === 'Mt Vernon' || city === 'Mt.Vernon' || city === 'Mt. Vernon') return 'Mount Vernon';
    if (city === 'W Alexandria' || city === 'W. Alexandria') return 'West Alexandria';
    if (city === 'Washington Ct. House' || city === 'Washington Ct House' ||
        city === 'Washington Court Hou') return 'Washington Court House';
    if (city === 'West Chester Twp' || city === 'West Chester Twp.') return 'West Chester Township';
    if (city === 'Sylvania Twp' || city === 'Sylvania Twp.') return 'Sylvania Township';
    if (city === 'Washington Twp' || city === 'Washington Twp.') return 'Washington Township';
    if (city === 'Brookfield Twp' || city === 'Brookfield Twp.') return 'Brookfield Township';
  }

  // OR-specific normalizations
  if (state === 'OR') {
    if (city === 'Milwaukee') return 'Milwaukie';  // Oregon spelling
  }

  // WA-specific normalizations
  if (state === 'WA') {
    if (city === 'E.Wenatchee' || city === 'E. Wenatchee' || city === 'E Wenatchee') return 'East Wenatchee';
    if (city === 'Lynwood') return 'Lynnwood';  // Double n
    if (city === 'Mt.Vernon' || city === 'Mt. Vernon' || city === 'Mt Vernon') return 'Mount Vernon';
    if (city === 'Spokane City') return 'Spokane';
  }

  // Quebec - accent and hyphen handling
  if (state === 'QC') {
    if (city === 'Montreal') return 'Montréal';
    if (city === 'Quebec') return 'Québec';
    if (city === 'Levis') return 'Lévis';
    if (city === 'St-Eustache' || city === 'St. Eustache' || city === 'St Eustache') return 'Saint-Eustache';
    if (city === 'Saint-Bruno' || city === 'St-Bruno' || city === 'St. Bruno') return 'Saint-Bruno-de-Montarville';
    if (city === 'Lasalle' || city === 'La Salle' || city === 'LaSalle') return 'Montréal';  // LaSalle merged with Montreal in 2002
    if (city === 'Beauport' || city === 'Sainte-Foy') return 'Québec';  // Merged with Quebec City in 2002
  }

  // General normalizations for abbreviated directional prefixes
  // E Brunswick -> East Brunswick, N Augusta -> North Augusta, etc.
  if (city.match(/^E\.?\s+/)) city = 'East ' + city.replace(/^E\.?\s+/, '');
  if (city.match(/^N\.?\s+/)) city = 'North ' + city.replace(/^N\.?\s+/, '');
  if (city.match(/^S\.?\s+/)) city = 'South ' + city.replace(/^S\.?\s+/, '');
  if (city.match(/^W\.?\s+/)) city = 'West ' + city.replace(/^W\.?\s+/, '');

  // Common abbreviations
  if (city.match(/\sHgts?$/i)) city = city.replace(/\sHgts?$/i, ' Heights');
  if (city.match(/\sSpgs?$/i)) city = city.replace(/\sSpgs?$/i, ' Springs');

  // Fix "Mc " with space to "Mc" without space (Mc Allen -> McAllen)
  if (city.match(/^Mc /)) city = 'Mc' + city.substring(3);

  // Fix missing apostrophe in O' and D' names
  if (city === 'O Fallon') return "O'Fallon";
  if (city === 'O Neill') return "O'Neill";
  if (city === 'D Iberville') return "D'Iberville";

  // Coeur d'Alene variations
  if (city === 'Coeur D Alene' || city === "Coeur D' Alene" || city === 'Coeur dAlene' ||
      city === "Coeur d'Alene") {  // Unicode apostrophe
    return "Coeur d'Alene";
  }

  // Fix Ft/Ft. -> Fort (general)
  if (city.match(/^Ft\s+/)) city = 'Fort' + city.substring(2);
  if (city.match(/^Ft\.\s*/)) city = 'Fort ' + city.substring(city.indexOf('.') + 1).trim();

  // Fix Forth -> Fort (common typo)
  if (city.match(/^Forth\s+/)) city = 'Fort' + city.substring(5);

  // Fix Mt/Mt. -> Mount (general)
  if (city.match(/^Mt\s+/)) city = 'Mount' + city.substring(2);
  if (city.match(/^Mt\.\s*/)) city = 'Mount ' + city.substring(city.indexOf('.') + 1).trim();

  // Fix " Ciy" or " Cty" -> " City" (common typos)
  city = city.replace(/ Ciy$/, ' City');
  city = city.replace(/ Cty$/, ' City');

  // Fix common city name typos (multi-state)
  if (city === 'Albuquereque') return 'Albuquerque';
  if (city === 'Indianpolis') return 'Indianapolis';
  if (city === 'Jacksonsville') return 'Jacksonville';
  if (city === 'Mineapolis') return 'Minneapolis';
  if (city === 'Milwakee' || city === 'Milwauke') return 'Milwaukee';
  if (city === 'Nashvill') return 'Nashville';
  if (city === 'Pheonix') return 'Phoenix';
  if (city === 'Queens Creek') return 'Queen Creek';
  if (city === 'Alpheretta') return 'Alpharetta';

  // Double-letter typo fixes
  if (city === 'Chattanoooga') return 'Chattanooga';
  if (city === 'Milsboro') return 'Millsboro';
  if (city === 'Belle Chase') return 'Belle Chasse';
  if (city === 'Hyatsville') return 'Hyattsville';
  if (city === 'Rulleville') return 'Ruleville';
  if (city === 'Pfaftown') return 'Pfafftown';
  if (city === 'Bayone') return 'Bayonne';
  if (city === 'Hewlet') return 'Hewlett';
  if (city === 'Halstead' || city === 'Hallsted') return 'Hallstead';
  if (city === 'Bennetsville') return 'Bennettsville';
  if (city === 'Murells Inlet') return 'Murrells Inlet';
  if (city === 'Moristown') return 'Morristown';
  if (city === 'Carollton') return 'Carrollton';
  if (city === 'Jarrel') return 'Jarrell';
  if (city === 'Creedmor') return 'Creedmoor';
  if (city === 'Mezeppa') return 'Mazeppa';
  if (city === 'Hohokus') return 'Ho-Ho-Kus';
  if (city === 'Frankinton') return 'Franklinton';

  // Fix vile -> ville typos
  if (city.endsWith('vile') && !city.endsWith('ville')) {
    city = city.slice(0, -4) + 'ville';
  }

  return city;
}

// US state abbreviations for URL parsing
const STATE_ABBREVS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

/**
 * Extract city and state from URL patterns like:
 * - ritasice.com/location/ritas-of-emmaus-pa/
 * - ritasice.com/location/ritas-of-dickson-city-pa/
 */
function extractLocationFromUrl(url) {
  if (!url) return { city: '', state: '' };

  // Pattern: /ritas-of-{city}-{state}/ or similar
  const match = url.match(/\/(?:ritas-of-|location\/|store\/)([a-z0-9-]+)(?:\/|$)/i);
  if (!match) return { city: '', state: '' };

  const slug = match[1].toLowerCase();
  const parts = slug.split('-');

  // Find state abbreviation (last 2-letter part that matches a state)
  let stateIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].length === 2 && STATE_ABBREVS.includes(parts[i].toUpperCase())) {
      stateIndex = i;
      break;
    }
  }

  if (stateIndex < 1) return { city: '', state: '' };

  const state = parts[stateIndex].toUpperCase();
  // City is everything before the state, with common prefixes removed
  let cityParts = parts.slice(0, stateIndex);
  // Remove common prefixes like "ritas", "of", "loc", numbers
  cityParts = cityParts.filter(p =>
    !['ritas', 'of', 'loc', 'store', 'location'].includes(p) &&
    !p.match(/^\d+$/)
  );

  if (cityParts.length === 0) return { city: '', state: '' };

  // Convert to proper case
  const city = cityParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

  return { city, state };
}

/**
 * Extract city from name field
 * Handles multiple formats:
 * - "Brand - Location Address - City" (Hannaford style)
 * - "Brand Store of City" (Food Lion style)
 * - "Brand in City" (various)
 * - "Brand City" (simple)
 */
function extractCityFromName(name, brandDisplayName) {
  if (!name) return '';

  // Pattern 1: "Brand - Location - City" (Hannaford style)
  const parts = name.split(' - ');
  if (parts.length >= 2) {
    const city = parts[parts.length - 1].trim();
    if (city && !city.match(/^\d/)) {
      return city;
    }
  }

  // Pattern 2: "Brand Store of City" or "Brand Grocery Store of City" (Food Lion style)
  // Also handles "Rita's of City STATE" pattern (note: handles both ASCII and Unicode apostrophes)
  const ofMatch = name.match(/(?:Store|Grocery|Market|Shop|['\u2019]s)\s+of\s+(.+)$/i);
  if (ofMatch) {
    // Clean up the city - remove trailing state abbreviation and extra info
    let city = ofMatch[1].trim();
    city = city.replace(/\s+[A-Z]{2}$/, ''); // Remove trailing state like "PA"
    city = city.replace(/\s+Loc\.?\s*\d*$/i, ''); // Remove "Loc. 4" suffix
    city = city.replace(/\s*&\s*\w+\s+Co\.?$/i, ''); // Remove "& Wayne Co." suffix
    return city;
  }

  // Pattern 3: "Brand in City" or "Brand at City"
  const inMatch = name.match(/\s+(?:in|at)\s+([A-Za-z\s]+)$/i);
  if (inMatch) {
    return inMatch[1].trim();
  }

  // Pattern 4: "Brand #123 City" or "Brand City #123" - extract city after brand name
  if (brandDisplayName) {
    // Remove brand name prefix
    let remainder = name.replace(new RegExp(`^${brandDisplayName}\\s*`, 'i'), '').trim();
    // Remove store numbers like "#123" or "Store 123"
    remainder = remainder.replace(/#?\d+\s*/g, '').trim();
    // Remove common suffixes
    remainder = remainder.replace(/\s*(Store|Grocery|Market|Shop|Location)$/i, '').trim();
    // If we have something left that looks like a city name
    if (remainder && remainder.length >= 3 && !remainder.match(/^\d/) &&
        !remainder.match(/^(blvd|st|ave|rd|dr|ln|ct|way|pk|pkwy|hwy)/i)) {
      return remainder;
    }
  }

  return '';
}

console.log(`Extracting ${brandKey} from ${spiderName}${filterBrand ? ` (filtering for brand: ${filterBrand})` : ''}...`);

try {
  // Try to read GeoJSON from extracted folder first, then fall back to ZIP
  const geojsonFile = `${spiderName}.geojson`;
  const extractedPath = path.join(ATP_DIR, geojsonFile);
  const zipGeojsonPath = `output/${spiderName}.geojson`;
  const tmpFile = `/tmp/${spiderName}.geojson`;

  let raw;
  if (fs.existsSync(extractedPath)) {
    // Read from extracted folder
    console.log(`  Reading from extracted folder: ${extractedPath}`);
    raw = fs.readFileSync(extractedPath, 'utf-8');
  } else if (fs.existsSync(ZIP_FILE)) {
    // Fall back to ZIP file
    try {
      execSync(`unzip -p "${ZIP_FILE}" "${zipGeojsonPath}" > "${tmpFile}"`, { stdio: 'pipe' });
      raw = fs.readFileSync(tmpFile, 'utf-8');
    } catch (err) {
      console.error(`Spider "${spiderName}" not found in ATP data`);
      console.log('\nSearching for similar names...');
      try {
        const searchResult = execSync(`unzip -l "${ZIP_FILE}" | grep -i "${brandKey}" | head -10`, { encoding: 'utf-8' });
        console.log(searchResult || 'No matches found');
      } catch (e) {
        // Search failed too
      }
      // Also search extracted folder
      if (fs.existsSync(ATP_DIR)) {
        console.log('\nSearching extracted folder...');
        try {
          const files = fs.readdirSync(ATP_DIR).filter(f => f.toLowerCase().includes(brandKey.toLowerCase()));
          console.log(files.slice(0, 10).join('\n') || 'No matches found');
        } catch (e) {
          // Search failed
        }
      }
      process.exit(1);
    }
  } else {
    console.error(`Spider "${spiderName}" not found - no extracted folder or ZIP file available`);
    process.exit(1);
  }

  if (!raw || raw.length === 0) {
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
      if (country !== 'US' && country !== '') return false;

      // Filter out known test data entries
      let city = getProperty(f.properties, 'addr:city', 'city');
      const state = getProperty(f.properties, 'addr:state', 'state');
      if (city === 'Test' && state === 'AL') return false;

      // Try to extract city from addr:full if missing (for filtering purposes)
      if (!city && f.properties['addr:full']) {
        city = extractCityFromFull(f.properties['addr:full']);
      }

      // Filter out hotel/resort names that appear in city field
      if (isHotelOrResortName(city)) return false;

      // Filter out obviously invalid city names (but allow empty if we have sources to derive city from)
      const canDeriveCityFromName = f.properties['name'] && f.properties['name'].includes(' of ');
      if (isInvalidCityName(city) && !f.properties['addr:full'] && !f.properties['addr:postcode'] && !f.properties['postcode'] && !canDeriveCityFromName) return false;

      return true;
    })
    .map(f => {
      const props = f.properties;

      // Try all property name variations
      let state = getProperty(props, 'addr:state', 'state');
      let city = getProperty(props, 'addr:city', 'city');
      const address = getProperty(props, 'addr:street_address', 'addr:street', 'street_address', 'addr:full');

      // Fallback 1: extract city from addr:full if missing
      if (!city) {
        city = extractCityFromFull(props['addr:full']);
      }

      // Fallback 2: extract city from name field (multiple patterns)
      if (!city) {
        city = extractCityFromName(props['name'], displayName);
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

      // Fallback 4: look up city and state from postal code
      const postcode = getProperty(props, 'addr:postcode', 'postcode');
      if (!city) {
        city = getCityFromPostcode(postcode);
      }
      if (!state) {
        state = getStateFromPostcode(postcode);
      }

      // Fallback 5: extract from URL (for brands like Rita's that have location in URL)
      if (!city || !state) {
        const urlInfo = extractLocationFromUrl(props['@source_uri'] || props['website']);
        if (!city && urlInfo.city) city = urlInfo.city;
        if (!state && urlInfo.state) state = urlInfo.state;
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
