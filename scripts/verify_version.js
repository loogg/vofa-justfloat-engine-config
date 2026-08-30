'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package-lock.json'), 'utf8'));
const version = packageJson.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json contains an invalid Semantic Version: ${version}`);
}
if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
  throw new Error(`Version mismatch: package.json=${version}, package-lock.json=${packageLock.version}, root=${packageLock.packages?.['']?.version}`);
}
if (packageJson.name !== packageLock.name || packageJson.name !== packageLock.packages?.['']?.name) {
  throw new Error('Package name mismatch between package.json and package-lock.json');
}

const requestedTag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
if (requestedTag && requestedTag !== `v${version}`) {
  throw new Error(`Tag ${requestedTag} does not match package version v${version}`);
}

console.log(`Version verified: ${packageJson.name}@${version}${requestedTag ? ` (${requestedTag})` : ''}`);
