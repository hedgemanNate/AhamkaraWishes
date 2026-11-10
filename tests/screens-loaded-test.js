// Every screen the shell uses must actually be loaded by sidepanel.html. The
// shell quietly skips a screen whose script is missing (it checks `root.AWx ?`),
// so a forgotten <script> tag shows up as a feature that does nothing - which
// is how the Admin screen went missing once.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const loaded = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const shell = fs.readFileSync(path.join(ROOT, 'screens', 'shell.js'), 'utf8');

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

const files = fs.readdirSync(path.join(ROOT, 'screens')).filter((f) => f.endsWith('.js'));
files.forEach((f) => check(`screens/${f} is loaded by sidepanel.html`, loaded.includes(`screens/${f}`)));
check('the shell loads after every screen it composes', loaded.indexOf('screens/shell.js') === loaded.length - 1
  || files.filter((f) => f !== 'shell.js').every((f) => loaded.indexOf(`screens/${f}`) < loaded.indexOf('screens/shell.js')));

// every AWxxx global the shell creates a screen from is defined by one of the screens
const defined = new Set();
files.forEach((f) => { for (const m of fs.readFileSync(path.join(ROOT, 'screens', f), 'utf8').matchAll(/root\.(AW\w+)\s*=/g)) defined.add(m[1]); });
const used = new Set([...shell.matchAll(/root\.(AW\w+Screen|AWWishes)\b(?:\s*\?\s*root\.\1\.create|\.create)/g)].map((m) => m[1]));
used.forEach((name) => check(`the shell's ${name} is defined by a screen`, defined.has(name)));
check('the shell composes at least the main screens', used.size >= 6, [...used].join());

// the build ships every screen
const build = fs.readFileSync(path.join(ROOT, 'build-extension.sh'), 'utf8');
check('build-extension.sh copies screens/*.js', /cp screens\/\*\.js/.test(build));

if (failures) { console.error(`\n${failures} screens-loaded check(s) failed`); process.exit(1); }
console.log('\nAll screens-loaded checks passed');
