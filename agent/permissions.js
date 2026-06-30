/**
 * Galaxy AI - Permission System
 * Auto-grants on Render/cloud (non-interactive). Prompts on local Windows.
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { DATA_DIR } = require('./config');

const PERMISSIONS_FILE = path.join(DATA_DIR, 'permissions.json');

const PERMISSIONS = [
  { id: 'screen',    name: 'Screen Capture',   desc: 'Take screenshots' },
  { id: 'mouse',     name: 'Mouse Control',     desc: 'Move cursor and click' },
  { id: 'keyboard',  name: 'Keyboard Input',    desc: 'Type text and press keys' },
  { id: 'files',     name: 'File System',        desc: 'Read and write files' },
  { id: 'apps',      name: 'App Launcher',       desc: 'Open and close applications' },
  { id: 'commands',  name: 'System Commands',    desc: 'Run PowerShell commands' },
  { id: 'clipboard', name: 'Clipboard',          desc: 'Read and write clipboard' },
];

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a); }));
}

async function requestPermissions() {
  if (fs.existsSync(PERMISSIONS_FILE)) {
    const p = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
    if (p.granted) { console.log('Permissions already granted.\n'); return p; }
  }

  // Auto-grant when not running interactively (Render / cloud / CI)
  if (!process.stdin.isTTY) {
    const perms = {
      granted: true,
      grantedAt: new Date().toISOString(),
      permissions: PERMISSIONS.reduce((a, p) => ({ ...a, [p.id]: true }), {})
    };
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(perms, null, 2));
    console.log('Permissions auto-granted (non-interactive mode).\n');
    return perms;
  }

  console.log('\nGalaxy needs permission to control this PC.\n');
  PERMISSIONS.forEach(p => console.log('  ' + p.name + ' — ' + p.desc));
  console.log('');

  const ans = await ask('Grant all permissions and start Galaxy? (yes/no): ');
  const granted = ans.trim().toLowerCase().startsWith('y');

  const perms = {
    granted,
    grantedAt: new Date().toISOString(),
    permissions: PERMISSIONS.reduce((a, p) => ({ ...a, [p.id]: granted }), {})
  };
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(perms, null, 2));

  if (granted) {
    console.log('\nAll permissions granted!\n');
  } else {
    console.log('\nPermissions required. Run again and type "yes".\n');
    process.exit(0);
  }
  return perms;
}

module.exports = { requestPermissions, PERMISSIONS };
