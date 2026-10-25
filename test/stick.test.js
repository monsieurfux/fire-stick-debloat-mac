// Runs the core logic against the pretend Fire Stick in fake-adb.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRunner } = require('../src/core/adb');
const { Stick } = require('../src/core/stick');

const FAKE = path.join(__dirname, 'fake-adb.js');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-test-'));
  const stateDir = path.join(dir, 'stick');
  const dataDir = path.join(dir, 'data');
  process.env.FAKE_ADB_STATE = stateDir;
  const run = makeRunner(process.execPath);
  const runFake = (args, opts) => run([FAKE, ...args], opts);
  const logs = [];
  const stick = new Stick({ run: runFake, ip: '192.168.1.23', dataDir, log: (m, l) => logs.push([l, m]) });
  const state = () => JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'));
  return { stick, state, dataDir, logs };
}

test('connects, names the stick and creates a per-serial list', async () => {
  const { stick, dataDir } = setup();
  const r = await stick.open();
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Living Room Fire TV');
  assert.equal(stick.logFile, path.join(dataDir, 'removed-G070VM1234567890.txt'));
  assert.equal(r.removedCount, 0);
});

test('preview lists ads automatically and asks only about recognisable apps', async () => {
  const { stick } = setup();
  await stick.open();
  const pv = await stick.preview();
  assert.deepEqual(pv.auto, ['com.amazon.kso', 'com.amazon.device.crashmanager', 'com.amazon.dp.logger', 'com.amazon.alexashopping', 'com.amazon.wifilocker', 'com.amazon.tv.csapp']);
  const asked = pv.asked.map((a) => a.pkg);
  assert.ok(asked.includes('com.amazon.amazonvideo.livingroom'));
  assert.ok(asked.includes('com.netflix.ninja'));
  assert.ok(asked.includes('com.amazon.firetv.youtube'), 'YouTube is a known Amazon app and is offered');
  assert.ok(!asked.includes('com.amazon.somebackgroundservice'), 'unknown Amazon services are never offered');
  assert.ok(!asked.includes('com.amazon.tv.launcher'), 'protected apps are never offered');
});

test('cleanup disables ads, falls back to uninstall -k, records everything, syncs to the stick', async () => {
  const { stick, state } = setup();
  await stick.open();
  const r = await stick.cleanup(['com.amazon.imdb.tv.android.app', 'com.netflix.ninja', 'com.amazon.tv.launcher', 'com.amazon.somebackgroundservice']);
  const s = state();
  assert.ok(s.disabled.includes('com.amazon.device.crashmanager'));
  assert.ok(!s.installed.includes('com.amazon.kso'), 'kso refused disable-user, so it was removed for user 0');
  assert.ok(r.failed.includes('com.amazon.tv.csapp'), 'csapp is refused by the pretend Fire OS');
  assert.ok(s.disabled.includes('com.amazon.imdb.tv.android.app'));
  assert.ok(s.disabled.includes('com.netflix.ninja'));
  assert.ok(!s.disabled.includes('com.amazon.amazonvideo.livingroom'), 'unticked apps are kept');
  assert.ok(s.installed.includes('com.amazon.tv.launcher'), 'protected apps are skipped even if sent');
  assert.deepEqual(r.skipped, ['com.amazon.tv.launcher', 'com.amazon.somebackgroundservice']);
  const list = stick.localList();
  assert.ok(list.includes('com.amazon.kso') && list.includes('com.netflix.ninja'));
  assert.ok(!list.includes('com.amazon.tv.csapp'));
  assert.equal(s.files['/sdcard/fire-stick-debloat/removed.txt'], `${list.join('\n')}\n`);
});

test('undo brings everything back and forgets the list', async () => {
  const { stick, state } = setup();
  await stick.open();
  await stick.cleanup(['com.netflix.ninja']);
  const before = stick.localList().length;
  assert.ok(before > 0);
  const r = await stick.undo();
  assert.equal(r.restored.length, before);
  const s = state();
  assert.deepEqual(s.disabled, []);
  assert.ok(s.installed.includes('com.amazon.kso'));
  assert.equal(stick.localList().length, 0);
  assert.equal(s.files['/sdcard/fire-stick-debloat/removed.txt'], undefined);
});

test('re-apply turns back off what an update re-enabled and hands Home to Projectivy', async () => {
  const { stick, state } = setup();
  await stick.open();
  await stick.cleanup(['com.netflix.ninja']);
  // Pretend an update re-enabled two apps and Projectivy was installed.
  const sf = path.join(process.env.FAKE_ADB_STATE, 'state.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.disabled = s.disabled.filter((p) => p !== 'com.netflix.ninja' && p !== 'com.amazon.dp.logger');
  s.installed.push('com.spocky.projengmenu');
  fs.writeFileSync(sf, JSON.stringify(s));
  const r = await stick.reapply();
  assert.deepEqual(r.back.sort(), ['com.amazon.dp.logger', 'com.netflix.ninja']);
  assert.equal(r.home.ok, true);
  const after = state();
  assert.ok(after.disabled.includes('com.netflix.ninja'));
  assert.equal(after.settings['secure/enabled_accessibility_services'], 'com.spocky.projengmenu/.service.PAccessibilityService');
  assert.equal(after.settings['secure/accessibility_enabled'], '1');
  assert.equal(after.files['/sdcard/fire-stick-debloat/home.txt'], 'com.spocky.projengmenu\n');
});

test('list on the stick is restored on a fresh Mac', async () => {
  const first = setup();
  await first.stick.open();
  await first.stick.cleanup(['com.netflix.ninja']);
  // Same stick, new data folder (another Mac): the list comes back from the stick.
  const otherData = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-other-'));
  const run = makeRunner(process.execPath);
  const second = new Stick({ run: (a, o) => run([FAKE, ...a], o), ip: '192.168.1.23', dataDir: otherData });
  const r = await second.open();
  assert.equal(r.removedCount, first.stick.localList().length);
});

test('enableProjectivy keeps other accessibility services and replaces Home on Fire', async () => {
  const { stick, state } = setup();
  await stick.open();
  const sf = path.join(process.env.FAKE_ADB_STATE, 'state.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.installed.push('com.spocky.projengmenu');
  s.settings['secure/enabled_accessibility_services'] = 'com.other/.TalkBack:io.github.toolicious.homeonfire/.HomeAccessibilityService';
  fs.writeFileSync(sf, JSON.stringify(s));
  const r = await stick.enableProjectivy();
  assert.equal(r.ok, true);
  assert.equal(state().settings['secure/enabled_accessibility_services'], 'com.other/.TalkBack:com.spocky.projengmenu/.service.PAccessibilityService');
});

test('installFile reports an app that needs a newer Android', async () => {
  const { stick } = setup();
  await stick.open();
  const apk = path.join(os.tmpdir(), 'projectivy-older-sdk.apk');
  fs.writeFileSync(apk, 'x');
  const r = await stick.installFile(apk);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'older-sdk');
  assert.equal(r.sdk, '30');
});

test('uninstallApp only touches apps you installed', async () => {
  const { stick, state } = setup();
  await stick.open();
  assert.equal((await stick.uninstallApp('com.amazon.amazonvideo.livingroom')).ok, false);
  assert.equal((await stick.uninstallApp('org.xbmc.kodi')).ok, true);
  assert.ok(!state().installed.includes('org.xbmc.kodi'));
});
