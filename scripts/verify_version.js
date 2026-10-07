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

const requestedTag = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || process.env.GITHUB_REF_NAME || '';
if (requestedTag && requestedTag !== `v${version}`) {
  throw new Error(`Tag ${requestedTag} does not match package version v${version}`);
}

if (process.argv.includes('--artifacts')) {
  const dist = path.join(packageRoot, 'dist');
  const base = `VOFA_JustFloat_Engine_Config_x64_${version}`;
  const expected = [`${base}_portable`, `${base}_portable.zip`, `${base}_setup.exe`].sort();
  const actual = fs.readdirSync(dist).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected dist artifacts: ${actual.join(', ')}`);
  if (!fs.statSync(path.join(dist, expected.find((entry) => entry.endsWith('_portable')))).isDirectory()) throw new Error('Missing portable directory');
  for (const suffix of ['_portable.zip', '_setup.exe']) {
    if (fs.statSync(path.join(dist, `${base}${suffix}`)).size === 0) throw new Error(`Empty artifact: ${suffix}`);
  }
  const asar = require('@electron/asar');
  const archive = path.join(dist, `${base}_portable`, 'resources', 'app.asar');
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  if (packaged.version !== version) throw new Error('Packaged app version mismatch');
  const files = asar.listPackage(archive);
  if (files.some((file) => /browser_review|scratch|(?:^|[\\/])test(?:[\\/]|$)/.test(file))) throw new Error('Development Bridge or test files leaked into the release');
  console.log(`Artifacts and production isolation verified: ${base}`);
}

console.log(`Version verified: ${packageJson.name}@${version}${requestedTag ? ` (${requestedTag})` : ''}`);
