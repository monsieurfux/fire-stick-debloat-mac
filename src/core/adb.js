// Finds Google's adb on this Mac, or downloads the official platform-tools
// into the app's data folder the first time it's needed. Google's license
// doesn't allow shipping adb inside the app, exactly like the Windows tool.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pipeline } = require('stream');
const https = require('https');

const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip';
const SDK_TERMS_URL = 'https://developer.android.com/studio/terms';

function exists(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

// Places adb usually lives on a Mac: this app's own copy, Homebrew, Android
// Studio, a platform-tools folder in Downloads, or anything on PATH.
function findAdb(dataDir) {
  const home = os.homedir();
  const places = [
    path.join(dataDir, 'platform-tools', 'adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    path.join(home, 'Downloads', 'platform-tools', 'adb'),
    path.join(home, 'Downloads', 'platform-tools-latest-darwin', 'platform-tools', 'adb'),
    path.join(home, 'Desktop', 'platform-tools', 'adb'),
  ];
  for (const p of places) if (exists(p)) return p;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'adb');
    if (exists(p)) return p;
  }
  return null;
}

// Downloads url to dest. Settles on every outcome: a dropped connection, a
// stalled transfer (no data for 30 s), a bad status or a redirect loop all
// reject, and a partial file is removed.
function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (u, hops) => {
      const req = https.get(u, { headers: { 'User-Agent': 'Debloat-for-Fire-TV-Mac' }, timeout: 30000 }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (hops >= 5) return reject(new Error('too many redirects'));
          return go(new URL(res.headers.location, u).toString(), hops + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        res.on('data', (chunk) => { got += chunk.length; if (onProgress) onProgress(got, total); });
        res.setTimeout(30000, () => res.destroy(new Error('the download stalled')));
        const file = fs.createWriteStream(dest);
        pipeline(res, file, (err) => {
          if (!err) return resolve();
          fs.rm(dest, { force: true }, () => reject(err));
        });
      });
      req.on('timeout', () => req.destroy(new Error('no answer from the server')));
      req.on('error', reject);
    };
    go(url, 0);
  });
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile('unzip', ['-o', '-q', zipPath, '-d', destDir], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

// Downloads platform-tools into <dataDir>/platform-tools and returns the adb path.
async function downloadPlatformTools(dataDir, onProgress) {
  fs.mkdirSync(dataDir, { recursive: true });
  const zip = path.join(dataDir, 'platform-tools-latest-darwin.zip');
  try {
    await download(PLATFORM_TOOLS_URL, zip, onProgress);
    await unzip(zip, dataDir);
  } finally {
    try { fs.unlinkSync(zip); } catch { /* nothing to clean */ }
  }
  const adb = path.join(dataDir, 'platform-tools', 'adb');
  if (!exists(adb)) throw new Error('platform-tools was downloaded but adb is missing from it');
  return adb;
}

// Runs adb and returns stdout and stderr merged, like the Windows tool does
// (adb reports device-side errors on either stream with exit code 0 or 1, so
// callers look at the text). It rejects only when adb itself could not run
// or was killed by the timeout: those are app problems, not stick answers.
function makeRunner(adbPath) {
  return (args, { timeout = 120000 } = {}) => new Promise((resolve, reject) => {
    execFile(adbPath, args, { timeout, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return reject(new Error(`adb could not be started: ${err.message}`));
      if (err && err.killed) return reject(new Error(`adb ${args.slice(0, 3).join(' ')} did not answer within ${timeout / 1000} s`));
      resolve(`${stdout || ''}${stderr || ''}`.replace(/\r/g, ''));
    });
  });
}

module.exports = { findAdb, downloadPlatformTools, makeRunner, unzip, download, PLATFORM_TOOLS_URL, SDK_TERMS_URL };
