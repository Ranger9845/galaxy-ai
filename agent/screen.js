/**
 * screen.js - screenshot via screen-capture.exe (Windows) or null (cloud/Render)
 */

const path             = require('path');
const { execFileSync } = require('child_process');
const fs               = require('fs');
const { isPkg }        = require('./config');

function getExePath() {
    if (isPkg) {
        return path.join(path.dirname(process.execPath), 'screen-capture.exe');
    }
    return path.join(__dirname, 'screen-capture.exe');
}

async function takeScreenshot() {
    const exe = getExePath();

    if (!fs.existsSync(exe)) {
        // On Render/cloud: screen capture not available, return null gracefully
        return null;
    }

    try {
        const buf = execFileSync(exe, [], {
            maxBuffer: 60 * 1024 * 1024,
            timeout: 12000
        });
        return buf.toString('base64');
    } catch (err) {
        console.error('[screen] Failed:', err.message.slice(0, 200));
        return null;
    }
}

module.exports = { takeScreenshot };
