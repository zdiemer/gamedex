/* Read a feature with its component declarations for VM/unit tests.
   Browser tests still exercise the actual deferred script order. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const manifest = require('../components/locations.json');
function readAppSource(filename, options) {
  const relative = path.relative(path.join(root, 'static'), path.resolve(filename)).split(path.sep).join('/');
  const files = manifest.bindings[relative];
  if (!files) return fs.readFileSync(filename, options);
  return files.map(file => fs.readFileSync(path.join(root, 'static', file), options)).join('\n');
}
module.exports = { readAppSource };
