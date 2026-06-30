/**
 * Galaxy AI - PC Control
 * Uses control-helper.exe on Windows; gracefully no-ops on Render/cloud.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { isPkg } = require('./config');

function getExePath() {
    if (isPkg) {
        return path.join(path.dirname(process.execPath), 'control-helper.exe');
    }
    return path.join(__dirname, 'control-helper.exe');
}

function runControl(action) {
    const exe = getExePath();
    if (!fs.existsSync(exe)) {
        return { error: 'control-helper.exe not found (Windows only)' };
    }
    const res = spawnSync(exe, [], {
        input: JSON.stringify(action),
        encoding: 'utf8',
        timeout: 15000
    });
    if (res.error) return { error: res.error.message };
    const out = (res.stdout || '').trim();
    try { return out ? JSON.parse(out) : { success: true }; }
    catch (_) { return { success: true }; }
}

function encodePS(script) {
    return Buffer.from(script, 'utf16le').toString('base64');
}

function runPS(script, silent) {
    try {
        const result = execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePS(script)],
            { encoding: 'utf8', timeout: 15000 }
        );
        return result.trim();
    } catch (err) {
        if (!silent) console.error('[control] PS error:', err.message.split('\n')[0]);
        return null;
    }
}

async function executeAction(action) {
    // On non-Windows (Render/cloud), skip actions that require native control
    if (process.platform !== 'win32') {
        if (['click','double_click','right_click','move_mouse','scroll','drag',
             'type','key','hotkey','focus_window','open_app','close_app',
             'set_clipboard','get_clipboard','run_command'].includes(action.type)) {
            return { error: 'PC control not available in cloud mode' };
        }
    }

    try {
        switch (action.type) {
            case 'move_mouse': case 'click': case 'double_click': case 'right_click':
            case 'scroll': case 'drag': case 'type': case 'key':
            case 'hotkey': case 'focus_window':
                return runControl(action);

            case 'open_app': {
                const app = (action.app || '').replace(/"/g, '`"');
                runPS('Start-Process "' + app + '"');
                break;
            }
            case 'close_app': {
                const name = (action.name || '').replace(/"/g, '');
                runPS('Get-Process -Name "' + name + '" -ErrorAction SilentlyContinue | Stop-Process -Force');
                break;
            }
            case 'read_file': {
                if (!fs.existsSync(action.path)) return { error: 'File not found: ' + action.path };
                return { content: fs.readFileSync(action.path, 'utf8') };
            }
            case 'write_file': {
                fs.mkdirSync(path.dirname(action.path), { recursive: true });
                fs.writeFileSync(action.path, action.content || '', 'utf8');
                return { success: true };
            }
            case 'list_files': {
                const dirPath = action.path || '.';
                if (!fs.existsSync(dirPath)) return { error: 'Path not found: ' + dirPath };
                const entries = fs.readdirSync(dirPath).map(name => {
                    const full = path.join(dirPath, name);
                    const stat = fs.statSync(full);
                    return { name, type: stat.isDirectory() ? 'folder' : 'file', size: stat.size };
                });
                return { entries };
            }
            case 'delete_file': {
                if (fs.existsSync(action.path)) {
                    fs.rmSync(action.path, { recursive: action.recursive || false });
                    return { success: true };
                }
                return { error: 'Not found' };
            }
            case 'set_clipboard': {
                const safe = (action.text || '').replace(/'/g, "''");
                runPS("Set-Clipboard -Value '" + safe + "'");
                break;
            }
            case 'get_clipboard': {
                return { text: runPS('Get-Clipboard') };
            }
            case 'run_command': {
                return { output: runPS(action.command || '') };
            }
            case 'wait':
                await new Promise(r => setTimeout(r, action.ms || 500));
                break;
            default:
                return { error: 'Unknown action: ' + action.type };
        }
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
}

module.exports = { executeAction, runPS };
