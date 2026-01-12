#!/usr/bin/env node
/**
 * Generate brands.zip containing all brand JSON files
 * Also updates manifest.json with the zip checksum
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BRANDS_DIR = path.join(__dirname, '..', 'brands');
const ZIP_PATH = path.join(__dirname, '..', 'brands.zip');
const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

// Remove existing zip
if (fs.existsSync(ZIP_PATH)) {
  fs.unlinkSync(ZIP_PATH);
}

// Create zip of all brand JSON files
console.log('Creating brands.zip...');
execSync(`cd "${path.dirname(BRANDS_DIR)}" && zip -r brands.zip brands/*.json`, { stdio: 'inherit' });

// Calculate checksum of the zip
const zipChecksum = execSync(`md5 -q "${ZIP_PATH}"`, { encoding: 'utf-8' }).trim();
const zipSize = fs.statSync(ZIP_PATH).size;

console.log(`\nZip created: ${(zipSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Zip checksum: ${zipChecksum}`);

// Update manifest with zip info
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
manifest.zip = {
  filename: 'brands.zip',
  checksum: zipChecksum,
  size: zipSize,
  generated: new Date().toISOString(),
};

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log('\nUpdated manifest.json with zip info');
