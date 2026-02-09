const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT_DIR = __dirname;
const MANIFEST_FILE = path.join(ROOT_DIR, 'destiny-manifest.js');
const OUTPUT_FILE = path.join(ROOT_DIR, 'masterwork-icon-urls.txt');

const MASTERWORK_STAT_HASH_BY_LABEL = {
  'Range': [1240592695],
  'Stability': [155624089],
  'Handling': [943549884],
  'Reload Speed': [4188031367, 4188031246],
  'Aim Assistance': [1345867579],
  'Recoil Direction': [2715839340, 4043523819],
  'Blast Radius': [3614673599],
  'Charge Time': [2961396640],
  'Impact': [4043523819, 4284049017],
  'Speed': [2837207746],
  'Draw Time': [447667954]
};

function normalizeStatName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function readManifestConfig() {
  const source = fs.readFileSync(MANIFEST_FILE, 'utf8');
  const apiKeyMatch = source.match(/const\s+API_KEY\s*=\s*['"]([^'"]+)['"]/);
  const rootMatch = source.match(/const\s+BUNGIE_ROOT\s*=\s*['"]([^'"]+)['"]/);
  if (!apiKeyMatch) {
    throw new Error('API_KEY not found in destiny-manifest.js');
  }
  return {
    apiKey: apiKeyMatch[1],
    root: rootMatch ? rootMatch[1] : 'https://www.bungie.net'
  };
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            const text = buffer.toString('utf8');
            reject(
              new Error(`HTTP ${res.statusCode} for ${url}: ${text.slice(0, 200)}`)
            );
            return;
          }
          resolve({ buffer, headers: res.headers });
        });
      })
      .on('error', reject);
  });
}

function decodeJsonBuffer(buffer, headers) {
  const encoding = String(headers?.['content-encoding'] || '').toLowerCase();
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const decoded = encoding.includes('gzip') || isGzip ? zlib.gunzipSync(buffer) : buffer;
  return JSON.parse(decoded.toString('utf8'));
}

async function fetchJson(url, headers) {
  const { buffer, headers: resHeaders } = await httpsGet(url, headers);
  return decodeJsonBuffer(buffer, resHeaders);
}

function findIconByName(statDefs, label) {
  const target = normalizeStatName(label);
  for (const key of Object.keys(statDefs)) {
    const def = statDefs[key];
    const name = def?.displayProperties?.name;
    if (name && normalizeStatName(name) === target) {
      return def?.displayProperties?.icon || '';
    }
  }
  return '';
}

async function main() {
  const { apiKey, root } = readManifestConfig();
  const manifestMeta = await fetchJson(`${root}/Platform/Destiny2/Manifest/`, {
    'X-API-Key': apiKey,
    Accept: 'application/json'
  });

  const response = manifestMeta?.Response || manifestMeta?.response || manifestMeta;
  const lang = 'en';
  let pathFromMeta = response?.jsonWorldComponentContentPaths?.[lang]?.DestinyStatDefinition;
  let componentMode = true;

  if (!pathFromMeta) {
    pathFromMeta = response?.jsonWorldContentPaths?.[lang];
    componentMode = false;
  }

  if (!pathFromMeta) {
    throw new Error('Manifest metadata did not include a DestinyStatDefinition path.');
  }

  const manifestUrl = pathFromMeta.startsWith('http') ? pathFromMeta : `${root}${pathFromMeta}`;
  const manifestJson = await fetchJson(manifestUrl, { Accept: 'application/json' });
  const statDefs = componentMode
    ? manifestJson
    : manifestJson?.DestinyStatDefinition;

  if (!statDefs || typeof statDefs !== 'object') {
    throw new Error('DestinyStatDefinition data not found in manifest JSON.');
  }

  const lines = [];
  for (const [label, hashes] of Object.entries(MASTERWORK_STAT_HASH_BY_LABEL)) {
    let iconPath = '';
    let matchedHash = null;

    for (const hash of hashes) {
      const def = statDefs[String(hash)];
      const rawIcon = def?.displayProperties?.icon || '';
      if (rawIcon) {
        iconPath = rawIcon;
        matchedHash = hash;
        break;
      }
    }

    if (!iconPath) {
      iconPath = findIconByName(statDefs, label);
    }

    const iconUrl = iconPath
      ? (iconPath.startsWith('http') ? iconPath : `${root}${iconPath}`)
      : '';
    const hashText = matchedHash ? String(matchedHash) : '';
    lines.push(`${label}\t${hashText}\t${iconUrl}`);
  }

  fs.writeFileSync(OUTPUT_FILE, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${lines.length} lines to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error('Failed to export masterwork icon URLs.');
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
