#!/usr/bin/env node
/**
 * Extract brand data from OpenStreetMap via Overpass API
 *
 * Usage: node scripts/extract-osm-brand.js <brand_key> <display_name> <category> <overpass_query>
 *
 * Example:
 *   node scripts/extract-osm-brand.js biggby_coffee "Biggby Coffee" coffee 'nwr["brand"="Biggby Coffee"];'
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Usage: node scripts/extract-osm-brand.js <brand_key> <display_name> <category> <overpass_query>');
  console.log('Example: node scripts/extract-osm-brand.js biggby_coffee "Biggby Coffee" coffee \'nwr["brand"="Biggby Coffee"];\'');
  process.exit(1);
}

const [brandKey, displayName, category, overpassQuery] = args;
const useLocationName = args[4] === 'true';

const DATA_DIR = path.join(__dirname, '..', 'brands');
const MANIFEST_FILE = path.join(__dirname, '..', 'manifest.json');

// US state abbreviations for filtering
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU'
]);

// Canadian provinces
const CA_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'
]);

function queryOverpass(query) {
  return new Promise((resolve, reject) => {
    const fullQuery = `[out:json][timeout:180];${query}out center;`;
    const postData = `data=${encodeURIComponent(fullQuery)}`;

    const options = {
      hostname: 'overpass-api.de',
      port: 443,
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getState(tags) {
  // Try various state field names
  const state = tags['addr:state'] || tags['state'] || '';
  return state.toUpperCase();
}

function getCity(tags) {
  return tags['addr:city'] || tags['city'] || '';
}

function getAddress(tags) {
  if (tags['addr:street_address']) return tags['addr:street_address'];
  if (tags['addr:housenumber'] && tags['addr:street']) {
    return `${tags['addr:housenumber']} ${tags['addr:street']}`;
  }
  if (tags['addr:street']) return tags['addr:street'];
  if (tags['addr:full']) return tags['addr:full'];
  return '';
}

function getName(tags) {
  return tags['name'] || tags['branch'] || '';
}

function isUSOrCanada(tags, lat, lon) {
  const state = getState(tags);
  const country = (tags['addr:country'] || '').toUpperCase();

  // Check by country code
  if (country === 'US' || country === 'USA' || country === 'CA' || country === 'CAN') {
    return true;
  }

  // Check by state/province
  if (US_STATES.has(state) || CA_PROVINCES.has(state)) {
    return true;
  }

  // Check by coordinates (rough US/Canada bounding box)
  if (lat && lon) {
    // Continental US + Alaska + Hawaii + Canada: lat 24-72, lon -170 to -50
    if (lat >= 24 && lat <= 72 && lon >= -170 && lon <= -50) {
      return true;
    }
  }

  return false;
}

async function main() {
  console.log(`Extracting ${brandKey} from OSM...`);
  console.log(`Query: ${overpassQuery}`);

  let data;
  try {
    data = await queryOverpass(overpassQuery);
  } catch (err) {
    console.error('Error querying Overpass:', err.message);
    process.exit(1);
  }

  if (!data.elements || data.elements.length === 0) {
    console.error('No results found');
    process.exit(1);
  }

  console.log(`  Raw OSM elements: ${data.elements.length}`);

  const locations = [];
  const seen = new Set();

  for (const element of data.elements) {
    const tags = element.tags || {};

    // Get coordinates (use center for ways/relations)
    let lat, lon;
    if (element.type === 'node') {
      lat = element.lat;
      lon = element.lon;
    } else if (element.center) {
      lat = element.center.lat;
      lon = element.center.lon;
    }

    if (!lat || !lon) continue;

    // Filter to US/Canada only
    if (!isUSOrCanada(tags, lat, lon)) continue;

    // Deduplicate by coordinates (rounded to ~10m precision)
    const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(coordKey)) continue;
    seen.add(coordKey);

    const state = getState(tags);
    const city = getCity(tags);
    const address = getAddress(tags);
    const name = getName(tags);

    locations.push({
      lat: parseFloat(lat.toFixed(5)),
      lon: parseFloat(lon.toFixed(5)),
      city: city,
      state: state,
      address: address,
      name: useLocationName ? name : ''
    });
  }

  if (locations.length === 0) {
    console.error('No US/Canada locations found after filtering');
    process.exit(1);
  }

  // Sort by state, then city
  locations.sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    return a.city.localeCompare(b.city);
  });

  // Calculate stats
  const withState = locations.filter(l => l.state).length;
  const withCity = locations.filter(l => l.city).length;
  const withAddress = locations.filter(l => l.address).length;

  console.log(`  US/Canada locations: ${locations.length}`);
  console.log(`  With state: ${withState} (${Math.round(withState/locations.length*100)}%)`);
  console.log(`  With city: ${withCity} (${Math.round(withCity/locations.length*100)}%)`);
  console.log(`  With address: ${withAddress} (${Math.round(withAddress/locations.length*100)}%)`);

  // Build output object
  const output = {
    key: brandKey,
    displayName: displayName,
    category: category,
    useLocationName: useLocationName,
    source: 'osm',
    locations: locations
  };

  // Write brand file
  const outputPath = path.join(DATA_DIR, `${brandKey}.json`);
  const jsonContent = JSON.stringify(output, null, 2)
    .replace(/\[\n\s+\{/g, '[{')
    .replace(/\}\n\s+\]/g, '}]')
    .replace(/\},\n\s+\{/g, '},\n  {');

  // Convert to compact format like other brand files
  const lines = [`{"key":"${brandKey}","displayName":"${displayName}","category":"${category}","useLocationName":${useLocationName},"source":"osm","locations":[`];
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const comma = i < locations.length - 1 ? ',' : '';
    lines.push(`  {"lat":${loc.lat},"lon":${loc.lon},"city":"${loc.city}","state":"${loc.state}","address":"${loc.address.replace(/"/g, '\\"')}","name":"${loc.name.replace(/"/g, '\\"')}"}${comma}`);
  }
  lines.push(']}');

  fs.writeFileSync(outputPath, lines.join('\n'));

  const fileSize = Math.round(fs.statSync(outputPath).size / 1024);
  const checksum = crypto.createHash('md5').update(fs.readFileSync(outputPath)).digest('hex');

  console.log(`  File size: ${fileSize}KB`);
  console.log(`  Checksum: ${checksum}`);

  // Update manifest
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  manifest.brands[brandKey] = {
    displayName,
    category,
    locationCount: locations.length,
    fileSize,
    checksum,
    source: 'osm'
  };

  // Sort manifest brands alphabetically
  const sortedBrands = {};
  Object.keys(manifest.brands).sort().forEach(key => {
    sortedBrands[key] = manifest.brands[key];
  });
  manifest.brands = sortedBrands;

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Created brands/${brandKey}.json with ${locations.length} locations (source: OSM)`);
  console.log('✓ Updated manifest.json');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
