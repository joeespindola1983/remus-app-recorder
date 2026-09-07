const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { calculateNextVersion } = require('../scripts/versionManager');

test('calculateNextVersion increments patch correctly', () => {
  assert.strictEqual(calculateNextVersion('2.0.0', 'patch'), '2.0.1');
  assert.strictEqual(calculateNextVersion('2.0.9', 'patch'), '2.0.10');
});

test('calculateNextVersion increments minor and resets patch', () => {
  assert.strictEqual(calculateNextVersion('2.0.1', 'minor'), '2.1.0');
  assert.strictEqual(calculateNextVersion('2.3.5', 'minor'), '2.4.0');
});

test('calculateNextVersion increments major and resets minor and patch', () => {
  assert.strictEqual(calculateNextVersion('2.1.3', 'major'), '3.0.0');
});

test('calculateNextVersion accepts explicit semver target', () => {
  assert.strictEqual(calculateNextVersion('0.1.0', '2.0.1'), '2.0.1');
});

test('project versions are synchronized across config files', () => {
  const rootDir = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const versionTs = fs.readFileSync(path.join(rootDir, 'src/version.ts'), 'utf8');
  const gradleContent = fs.readFileSync(path.join(rootDir, 'android/app/build.gradle'), 'utf8');
  const pbxContent = fs.readFileSync(path.join(rootDir, 'ios/remusapprecorder.xcodeproj/project.pbxproj'), 'utf8');

  // Verify version.ts exports current version
  assert.match(versionTs, new RegExp(`APP_VERSION = '${pkg.version}'`));

  // Verify android build.gradle matches
  assert.match(gradleContent, new RegExp(`versionName "${pkg.version}"`));

  // Verify iOS pbxproj matches
  assert.match(pbxContent, new RegExp(`MARKETING_VERSION = ${pkg.version};`));
});
