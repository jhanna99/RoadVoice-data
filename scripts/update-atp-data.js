#!/usr/bin/env node
/**
 * Update ATP data and generate comparison report
 *
 * Usage: node scripts/update-atp-data.js [--download] [--extract] [--report-only]
 *
 * Options:
 *   --download     Download latest ATP data
 *   --extract      Re-extract all brands from ATP data
 *   --report-only  Just show comparison without making changes
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const MANIFEST_FILE = path.join(__dirname, '..', 'manifest.json');
const ATP_ZIP = '/Users/johnhanna/Documents/RoadVoice/data/output.zip';
const ATP_URL = 'https://data.alltheplaces.xyz/runs/latest/output.zip';
const EXTRACT_ALL_SCRIPT = path.join(__dirname, 'extract-all-brands.js');

const args = process.argv.slice(2);
const shouldDownload = args.includes('--download');
const shouldExtract = args.includes('--extract');
const reportOnly = args.includes('--report-only');

/**
 * Get current location counts from manifest
 */
function getCurrentCounts() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  const counts = {};
  for (const [key, brand] of Object.entries(manifest.brands)) {
    // Only count ATP-sourced brands (no source field or source !== 'osm')
    if (!brand.source || brand.source !== 'osm') {
      counts[key] = {
        displayName: brand.displayName,
        count: brand.locationCount,
        category: brand.category
      };
    }
  }
  return { counts, atpBuildDate: manifest.atpBuildDate };
}

/**
 * Get ATP build date from zip file by inspecting file dates
 */
function getAtpBuildDate() {
  try {
    const output = execSync(`unzip -l "${ATP_ZIP}" | head -20`, { encoding: 'utf-8' });
    const datePattern = /(\d{2})-(\d{2})-(\d{4})/g;
    const dates = [];
    let match;
    while ((match = datePattern.exec(output)) !== null) {
      const [_, month, day, year] = match;
      dates.push(`${year}-${month}-${day}`);
    }
    if (dates.length > 0) {
      dates.sort();
      return dates[0]; // Earliest date is when build started
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

/**
 * Download latest ATP data using curl (more reliable for large files)
 */
function downloadATP() {
  console.log('Downloading latest ATP data from data.alltheplaces.xyz...');
  console.log('This is ~1.7GB and may take several minutes.\n');

  const tmpFile = ATP_ZIP + '.tmp';

  try {
    // Use curl with progress bar, follow redirects, and resume support
    execSync(`curl -L --progress-bar -o "${tmpFile}" "${ATP_URL}"`, {
      stdio: 'inherit'
    });

    // Move tmp to final location
    fs.renameSync(tmpFile, ATP_ZIP);

    console.log('');

    // Report which build was downloaded
    const buildDate = getAtpBuildDate();
    if (buildDate) {
      console.log(`Downloaded ATP build: ${buildDate}`);
    }
    console.log(`Saved to: ${ATP_ZIP}\n`);

  } catch (err) {
    // Clean up tmp file on failure
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    throw new Error(`Download failed: ${err.message}`);
  }
}

/**
 * Run extraction for all brands
 */
function extractAllBrands() {
  console.log('Extracting all brands from ATP data...\n');
  execSync(`node "${EXTRACT_ALL_SCRIPT}"`, { stdio: 'inherit' });
}

/**
 * Generate comparison report
 */
function generateReport(beforeCounts, afterCounts) {
  console.log('\n\n' + '='.repeat(80));
  console.log('ATP DATA UPDATE COMPARISON REPORT');
  console.log('='.repeat(80) + '\n');

  const changes = [];
  const unchanged = [];
  const newBrands = [];
  const removedBrands = [];

  // Compare
  for (const [key, after] of Object.entries(afterCounts.counts)) {
    const before = beforeCounts.counts[key];
    if (!before) {
      newBrands.push({ key, ...after });
    } else if (before.count !== after.count) {
      const diff = after.count - before.count;
      const pct = before.count > 0 ? Math.round(diff / before.count * 100) : 100;
      changes.push({
        key,
        displayName: after.displayName,
        before: before.count,
        after: after.count,
        diff,
        pct
      });
    } else {
      unchanged.push({ key, ...after });
    }
  }

  // Check for removed brands
  for (const key of Object.keys(beforeCounts.counts)) {
    if (!afterCounts.counts[key]) {
      removedBrands.push({ key, ...beforeCounts.counts[key] });
    }
  }

  // Sort changes by absolute difference
  changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Print summary
  const totalBefore = Object.values(beforeCounts.counts).reduce((sum, b) => sum + b.count, 0);
  const totalAfter = Object.values(afterCounts.counts).reduce((sum, b) => sum + b.count, 0);

  console.log(`ATP Build Date: ${beforeCounts.atpBuildDate || 'unknown'} -> ${afterCounts.atpBuildDate || 'unknown'}`);
  console.log(`Total ATP Brands: ${Object.keys(beforeCounts.counts).length} -> ${Object.keys(afterCounts.counts).length}`);
  console.log(`Total Locations: ${totalBefore.toLocaleString()} -> ${totalAfter.toLocaleString()} (${totalAfter >= totalBefore ? '+' : ''}${(totalAfter - totalBefore).toLocaleString()})`);
  console.log();

  // Significant increases
  const increases = changes.filter(c => c.diff > 0);
  if (increases.length > 0) {
    console.log('INCREASES (more locations):');
    console.log('-'.repeat(60));
    for (const c of increases.slice(0, 20)) {
      console.log(`  ${c.displayName.padEnd(30)} ${c.before.toString().padStart(6)} -> ${c.after.toString().padStart(6)} (+${c.diff}, +${c.pct}%)`);
    }
    if (increases.length > 20) {
      console.log(`  ... and ${increases.length - 20} more`);
    }
    console.log();
  }

  // Significant decreases
  const decreases = changes.filter(c => c.diff < 0);
  if (decreases.length > 0) {
    console.log('DECREASES (fewer locations):');
    console.log('-'.repeat(60));
    for (const c of decreases.slice(0, 20)) {
      console.log(`  ${c.displayName.padEnd(30)} ${c.before.toString().padStart(6)} -> ${c.after.toString().padStart(6)} (${c.diff}, ${c.pct}%)`);
    }
    if (decreases.length > 20) {
      console.log(`  ... and ${decreases.length - 20} more`);
    }
    console.log();
  }

  // New brands
  if (newBrands.length > 0) {
    console.log('NEW BRANDS:');
    console.log('-'.repeat(60));
    for (const b of newBrands) {
      console.log(`  ${b.displayName.padEnd(30)} ${b.count} locations`);
    }
    console.log();
  }

  // Removed brands
  if (removedBrands.length > 0) {
    console.log('REMOVED BRANDS:');
    console.log('-'.repeat(60));
    for (const b of removedBrands) {
      console.log(`  ${b.displayName.padEnd(30)} (had ${b.count} locations)`);
    }
    console.log();
  }

  console.log(`Unchanged: ${unchanged.length} brands`);
  console.log('\n' + '='.repeat(80));

  return { changes, unchanged, newBrands, removedBrands, totalBefore, totalAfter };
}

function main() {
  console.log('ATP Data Update Tool\n');

  // Get current counts (before)
  console.log('Reading current manifest...');
  const beforeCounts = getCurrentCounts();
  console.log(`Found ${Object.keys(beforeCounts.counts).length} ATP-sourced brands\n`);

  if (reportOnly) {
    console.log('Report-only mode: showing current state\n');
    const report = generateReport(beforeCounts, beforeCounts);
    return;
  }

  // Save before counts to temp file
  const beforeFile = '/tmp/atp-before-counts.json';
  fs.writeFileSync(beforeFile, JSON.stringify(beforeCounts, null, 2));

  if (shouldDownload) {
    downloadATP();
  }

  if (shouldExtract) {
    extractAllBrands();

    // Get new counts (after) and generate comparison report
    const afterCounts = getCurrentCounts();
    generateReport(beforeCounts, afterCounts);
  } else if (shouldDownload) {
    console.log('Download complete. Run with --extract to update brands and see comparison report.');
  }
}

try {
  main();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
