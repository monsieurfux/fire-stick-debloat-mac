// What happens when the stick or the network misbehaves.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { makeRunner, download } = require('../src/core/adb');
const { Stick } = require('../src/core/stick');

const FAKE = path.join(__dirname, 'fake-adb.js');

function stickWith(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-rob-'));
  return new Stick({ run, ip: '192.168.1.23', dataDir: dir });
}

test('adb error text is never mistaken for package names', async () => {
  const offline = async (args) => (args.includes('shell') ? 'error: device offline\n' : 'device\n');
  const s = stickWith(offline);
  assert.deepEqual(await s.getInstalled(), []);
  assert.deepEqual(await s.getYourApps(), []);
  assert.deepEqual(await s.getDisabled(), []);
  const pv = await s.preview();
  assert.deepEqual(pv.auto, []);
  assert.deepEqual(pv.asked, []);
});

test('an unreadable serial does not become a list file name', async () => {
  const run = async (args) => {
    const cmd = args[args.indexOf('shell') + 1] || '';
    if (/getprop|android_id/.test(cmd)) return 'error: device offline\n';
    return '';
  };
  const s = stickWith(run);
  await s.initRemovedList();
  assert.equal(path.basename(s.logFile), 'removed-unknown.txt');
});

test('junk lines in the local list are never sent to the stick', async () => {
  process.env.FAKE_ADB_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-rob-state-'));
  const run = makeRunner(process.execPath);
  const s = stickWith((a, o) => run([FAKE, ...a], o));
  await s.open();
  fs.writeFileSync(s.logFile, 'com.netflix.ninja\nfoo; rm -rf /sdcard/x\n\ncom.amazon.kso\n');
  assert.deepEqual(s.localList(), ['com.netflix.ninja', 'com.amazon.kso']);
  const r = await s.undo();
  assert.deepEqual(r.restored, ['com.amazon.kso', 'com.netflix.ninja']);
  const log = JSON.parse(fs.readFileSync(path.join(process.env.FAKE_ADB_STATE, 'state.json'), 'utf8')).log;
  assert.ok(!log.some((l) => l.includes('rm -rf /sdcard/x')));
});

test('a connection dropped mid-download rejects instead of hanging', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': '100000' });
    res.write(Buffer.alloc(1000));
    setTimeout(() => res.destroy(), 50);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dest = path.join(os.tmpdir(), `fsd-dl-${process.pid}.bin`);
  // download() upgrades nothing: it is https-only, so test through the same
  // pipeline logic with an http agent by monkey-patching the module's https.get.
  const https = require('https');
  const orig = https.get;
  https.get = (u, opts, cb) => http.get(u.replace('https://', 'http://'), opts, cb);
  try {
    await assert.rejects(download(`https://127.0.0.1:${server.address().port}/x`, dest), /aborted|socket hang up|ECONNRESET|Premature close/i);
    assert.ok(!fs.existsSync(dest), 'the partial file is removed');
  } finally {
    https.get = orig;
    server.close();
  }
});

test('a bad status rejects and leaves no file', async () => {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end('nope'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dest = path.join(os.tmpdir(), `fsd-dl404-${process.pid}.bin`);
  const https = require('https');
  const orig = https.get;
  https.get = (u, opts, cb) => http.get(u.replace('https://', 'http://'), opts, cb);
  try {
    await assert.rejects(download(`https://127.0.0.1:${server.address().port}/x`, dest), /HTTP 404/);
    assert.ok(!fs.existsSync(dest));
  } finally {
    https.get = orig;
    server.close();
  }
});

test('adb that cannot start rejects loudly', async () => {
  const run = makeRunner('/nonexistent/adb');
  await assert.rejects(run(['devices']), /could not be started/);
});
