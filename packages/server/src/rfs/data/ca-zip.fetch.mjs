// SPDX-License-Identifier: Apache-2.0
// One-shot: regenerates ca-zip.json from the public USPS dataset.
// Run: `node packages/server/src/rfs/data/ca-zip.fetch.mjs > packages/server/src/rfs/data/ca-zip.json`
// Source: GeoNames "US.zip" — CC-BY 4.0 — http://download.geonames.org/export/zip/US.zip
// Filters to state=CA and writes a compact { [zip]: { city, county } } object.
//
// NOTE: The shipped ca-zip.json currently contains a hand-seeded subset (~20 ZIPs covering
// the major California metros) so the operation is testable without external network calls.
// Run this script to regenerate the full ~2,600-entry CA-only dataset for production.

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ca-zip-'));
try {
  execSync('curl -sSL http://download.geonames.org/export/zip/US.zip -o US.zip', { cwd: tmp });
  execSync('unzip -o US.zip', { cwd: tmp });
  const lines = readFileSync(join(tmp, 'US.txt'), 'utf8').split('\n');
  const out = {};
  for (const line of lines) {
    // Columns: country, postal, city, state, stateCode, county, countyCode, ...
    const cols = line.split('\t');
    if (cols[4] !== 'CA') continue;
    const zip = cols[1]?.trim();
    const city = cols[2]?.trim();
    const county = cols[5]?.trim();
    if (!zip) continue;
    out[zip] = { city, county };
  }
  process.stdout.write(JSON.stringify(out));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
