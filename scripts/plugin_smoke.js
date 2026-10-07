'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getEnvironment } = require('../src/generator');

const root = path.resolve(__dirname, '..');
const dll = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!dll || !fs.statSync(dll).isFile()) throw new Error('Usage: node scripts/plugin_smoke.js <CustomFloat DLL built from examples/customfloat.vofa-engine.json>');
const environment = getEnvironment(path.join(root, 'test/fixtures/vofa-repository'));
if (!environment.ready) throw new Error(`Qt/MSVC environment unavailable: ${environment.missing.join(', ')}`);
const buildDirectory = path.join(root, 'scratch/plugin-smoke-build');
const temporaryDirectory = path.join(root, 'scratch/plugin-smoke-temp');
fs.mkdirSync(buildDirectory, { recursive: true });
fs.mkdirSync(temporaryDirectory, { recursive: true });
const quote = (value) => {
  if (/["\r\n%]/.test(value)) throw new Error('Unsupported build path');
  return `"${value}"`;
};
const commandFile = path.join(root, 'scratch/plugin-smoke.cmd');
fs.writeFileSync(commandFile, [
  '@echo off',
  `call ${quote(environment.vcVarsPath)} x64 -vcvars_ver=14.16`,
  'if errorlevel 1 exit /b %errorlevel%',
  `cd /d ${quote(buildDirectory)}`,
  `${quote(environment.qmakePath)} ${quote(path.join(root, 'test/plugin-smoke/plugin-smoke.pro'))} "CONFIG+=release" "CONFIG-=debug"`,
  'if errorlevel 1 exit /b %errorlevel%',
  `${quote(environment.jomPath)} -j2`,
  'if errorlevel 1 exit /b %errorlevel%',
  `set "PATH=${path.dirname(environment.qmakePath)};%PATH%"`,
  `${quote(path.join(buildDirectory, 'release/plugin-smoke.exe'))} ${quote(dll)}`,
  'exit /b %errorlevel%'
].join('\r\n'), 'utf8');
const result = spawnSync(environment.cmdPath, ['/d', '/c', commandFile], {
  cwd: root, env: { ...process.env, TEMP: temporaryDirectory, TMP: temporaryDirectory, QT_FORCE_STDERR_LOGGING: '1' },
  windowsHide: true, shell: false, stdio: 'inherit'
});
if (result.error) throw result.error;
process.exitCode = result.status || 0;
