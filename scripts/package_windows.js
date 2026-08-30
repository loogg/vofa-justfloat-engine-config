'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(packageRoot, 'package.json'));
const distDirectory = path.join(packageRoot, 'dist');
const artifactBase = `VOFA_JustFloat_Engine_Config_x64_${packageJson.version}`;
const portableDirectory = path.join(distDirectory, `${artifactBase}_portable`);
const portableZip = path.join(distDirectory, `${artifactBase}_portable.zip`);
const setupExe = path.join(distDirectory, `${artifactBase}_setup.exe`);

function assertInsideDist(target) {
  const resolved = path.resolve(target);
  if (resolved !== distDirectory && !resolved.startsWith(`${distDirectory}${path.sep}`)) {
    throw new Error(`Refusing to modify a path outside dist: ${resolved}`);
  }
  return resolved;
}

if (fs.existsSync(distDirectory)) fs.rmSync(assertInsideDist(distDirectory), { recursive: true, force: true });

const executable = process.execPath;
const builderCli = path.join(packageRoot, 'node_modules', 'electron-builder', 'cli.js');
// A pushed version tag makes electron-builder attempt an implicit GitHub publish.
// Publishing belongs to the release workflow so artifact creation must stay local.
const args = [builderCli, '--win', 'nsis', 'zip', '--x64', '--publish', 'never'];
const localElectron = path.join(packageRoot, 'node_modules', 'electron', 'dist');
if (fs.existsSync(localElectron)) args.push(`--config.electronDist=${localElectron}`);

const result = childProcess.spawnSync(executable, args, {
  cwd: packageRoot,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false' },
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const unpackedDirectory = path.join(distDirectory, 'win-unpacked');
if (!fs.existsSync(unpackedDirectory)) throw new Error('electron-builder did not create dist/win-unpacked');
if (!fs.existsSync(portableZip)) throw new Error(`Missing portable ZIP: ${portableZip}`);
if (!fs.existsSync(setupExe)) throw new Error(`Missing installer: ${setupExe}`);
if (fs.existsSync(portableDirectory)) fs.rmSync(assertInsideDist(portableDirectory), { recursive: true, force: true });
fs.renameSync(unpackedDirectory, portableDirectory);

for (const entry of fs.readdirSync(distDirectory)) {
  if (entry === 'builder-debug.yml' || entry === 'builder-effective-config.yaml' || entry.endsWith('.blockmap')) {
    fs.rmSync(assertInsideDist(path.join(distDirectory, entry)), { force: true });
  }
}

console.log('Windows artifacts:');
console.log(`- ${portableDirectory}`);
console.log(`- ${portableZip}`);
console.log(`- ${setupExe}`);
