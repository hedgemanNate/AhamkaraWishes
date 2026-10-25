#!/usr/bin/env node
// Copies the client modules the Supabase edge functions reuse into
// supabase/functions/_shared/client/, which is all Supabase bundles on deploy.
// The server then checks shared wishlists with exactly the rules the extension
// applies on import.
//
//   node tools/sync-edge-shared.js          copy
//   node tools/sync-edge-shared.js --check  exit 1 if a copy is out of date
//                                            (run by tests/edge-submission-test.js)
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'supabase', 'functions', '_shared', 'client');
const FILES = ['aw-dom.js', 'wishlist-validate.js'];

function stale() {
  return FILES.filter((f) => {
    const dest = path.join(DEST, f);
    return !fs.existsSync(dest) || !fs.readFileSync(dest).equals(fs.readFileSync(path.join(ROOT, f)));
  });
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const out = stale();
    if (out.length) {
      console.error(`Edge copies out of date: ${out.join(', ')}. Run: node tools/sync-edge-shared.js`);
      process.exit(1);
    }
    console.log('Edge copies match the extension.');
  } else {
    fs.mkdirSync(DEST, { recursive: true });
    for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(DEST, f));
    console.log(`Copied ${FILES.join(', ')} to ${path.relative(ROOT, DEST)}/`);
  }
}

module.exports = { FILES, DEST, stale };
