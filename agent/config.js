/**
 * Galaxy AI - Runtime Config
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const isPkg = !!process.pkg;

const DATA_DIR = isPkg
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'Galaxy AI')
  : path.join(__dirname, '..');

const PUBLIC_DIR = isPkg
  ? path.join(path.dirname(process.execPath), 'public')
  : path.join(__dirname, '..', 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = { DATA_DIR, PUBLIC_DIR, isPkg };
