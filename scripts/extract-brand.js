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

/**
 * Extract city from addr:full if separate city field is missing
 * Format: "123 Main St, City, ST 12345"
 */
function extractCityFromFull(addrFull) {
  if (!addrFull) return '';
  const parts = addrFull.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2];
    if (cityPart && !cityPart.match(/^\d/)) {
      return cityPart;
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

      // Fallback: extract city from addr:full if missing
      if (!city) {
        city = extractCityFromFull(props['addr:full']);
      }

      return {
        lat: Math.round(f.geometry.coordinates[1] * 1000000) / 1000000,
        lon: Math.round(f.geometry.coordinates[0] * 1000000) / 1000000,
        city: city,
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
