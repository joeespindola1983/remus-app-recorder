#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { calculateNextVersion, updateVersions } = require('./versionManager');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

// Extract current build number from android/app/build.gradle
const gradleContent = fs.readFileSync(path.join(rootDir, 'android/app/build.gradle'), 'utf8');
const match = gradleContent.match(/versionCode\s+(\d+)/);
const currentBuildNumber = match ? parseInt(match[1], 10) : 1;

const bumpArg = process.argv[2] || 'patch';
const nextVersion = calculateNextVersion(pkg.version, bumpArg);
const nextBuildNumber = currentBuildNumber + 1;

const result = updateVersions(rootDir, nextVersion, nextBuildNumber);

console.log(`\n========================================`);
console.log(`🚀 Remus Version Synchronization Tool`);
console.log(`========================================`);
console.log(`  Previous Version: ${result.oldVersion}`);
console.log(`  New Version:      ${result.newVersion}`);
console.log(`  Build Number:     ${result.buildNumber}`);
console.log(`  Display Tag:      v${result.newVersion} (${result.buildNumber})`);
console.log(`----------------------------------------`);
console.log(`  Updated:`);
console.log(`    - package.json`);
console.log(`    - android/app/build.gradle (versionName & versionCode)`);
console.log(`    - ios/remusapprecorder.xcodeproj (MARKETING_VERSION & CURRENT_PROJECT_VERSION)`);
console.log(`    - ios/RemusWatch/Info.plist (synced to Xcode build settings)`);
console.log(`    - src/version.ts (runtime application constants)`);
console.log(`========================================\n`);
