#!/usr/bin/env node
/**
 * Re-extract all brands from AllThePlaces data
 * Uses brand-mapping.json to get brand configurations
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BRAND_MAPPING_FILE = '/Users/johnhanna/Documents/RoadVoice/scripts/brand-mapping.json';
const EXTRACT_SCRIPT = path.join(__dirname, 'extract-brand.js');

// Load brand mapping
const mapping = JSON.parse(fs.readFileSync(BRAND_MAPPING_FILE, 'utf-8'));

// Flatten all brand categories
const allBrands = [];
for (const category of Object.keys(mapping.brands)) {
  for (const brand of mapping.brands[category]) {
    // Skip brands with filterBrand (they share a spider with another brand and need special handling)
    if (!brand.filterBrand) {
      allBrands.push(brand);
    }
  }
}

console.log(`Found ${allBrands.length} brands to extract\n`);

let success = 0;
let failed = 0;
const failures = [];

for (const brand of allBrands) {
  const { key, spider, displayName, category } = brand;

  // Some spiders have _us suffix
  const spiderVariants = [spider, `${spider}_us`];

  let extracted = false;
  for (const spiderName of spiderVariants) {
    try {
      console.log(`\n--- Extracting ${key} from ${spiderName} ---`);
      execSync(`node "${EXTRACT_SCRIPT}" "${key}" "${spiderName}" "${displayName}" "${category}"`, {
        stdio: 'inherit'
      });
      success++;
      extracted = true;
      break;
    } catch (err) {
      // Try next variant
    }
  }

  if (!extracted) {
    console.log(`FAILED: ${key}`);
    failed++;
    failures.push(key);
  }
}

console.log('\n\n=== SUMMARY ===');
console.log(`Success: ${success}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log(`\nFailed brands: ${failures.join(', ')}`);
}
