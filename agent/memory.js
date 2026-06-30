/**
 * Galaxy AI - Memory & User Profile System
 */

const fs   = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const MEMORY_FILE  = path.join(DATA_DIR, 'memory.json');
const PROFILE_FILE = path.join(DATA_DIR, 'user-profile.json');

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch { return {}; }
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function remember(key, value) {
  const mem = loadMemory();
  mem[key] = { value, savedAt: new Date().toISOString() };
  saveMemory(mem);
  return mem;
}

function forget(key) {
  const mem = loadMemory();
  delete mem[key];
  saveMemory(mem);
  return mem;
}

function loadProfile() {
  try {
    if (!fs.existsSync(PROFILE_FILE)) return null;
    return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
  } catch { return null; }
}

function saveProfile(profile) {
  const existing = loadProfile() || {};
  const merged = { ...existing, ...profile, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function buildContextString() {
  const profile = loadProfile();
  const memory  = loadMemory();
  const lines   = [];

  if (profile) {
    lines.push('');
    lines.push('─── WHO YOU\'RE HELPING ─────────────────────────────────');
    if (profile.name)          lines.push('Name:              ' + profile.name);
    if (profile.role)          lines.push('Role / occupation: ' + profile.role);
    if (profile.tasks?.length) lines.push('Common PC tasks:   ' + profile.tasks.join(', '));
    if (profile.tone)          lines.push('Preferred tone:    ' + profile.tone);
    if (profile.apps?.length)  lines.push('Frequent apps:     ' + profile.apps.join(', '));
    if (profile.context)       lines.push('Background:        ' + profile.context);
  }

  const keys = Object.keys(memory);
  if (keys.length > 0) {
    lines.push('');
    lines.push('─── MEMORY (facts you\'ve learned across past sessions) ──');
    keys.forEach(k => lines.push('* ' + k + ': ' + memory[k].value));
  }

  return lines.join('\n');
}

module.exports = {
  loadMemory, saveMemory, remember, forget,
  loadProfile, saveProfile,
  buildContextString
};
