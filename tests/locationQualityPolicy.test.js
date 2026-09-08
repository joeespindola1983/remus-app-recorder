const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');

test('LocationQualityPolicy: swift anomaly reproduction and fallback test suite passes', () => {
  const output = execSync(
    'swiftc -o /tmp/loc_test ios/RemusTelemetry/Domain/LocationQualityPolicy.swift tests/LocationQualityPolicyTests.swift && /tmp/loc_test',
    { encoding: 'utf8' }
  );
  assert.match(output, /All LocationQualityPolicyTests passed successfully!/);
});
