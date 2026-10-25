// Looks on this Mac's network for devices that accept ADB connections
// (port 5555), so nobody has to look up the stick's IP address. Only the local
// network is searched, 256 addresses at a time, and nothing is saved.
'use strict';

const os = require('os');
const net = require('net');

const PRIVATE = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/;
const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function ipToNum(ip) {
  return ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
}
function numToIp(n) {
  return [24, 16, 8, 0].map((s) => (Math.floor(n / (2 ** s)) % 256)).join('.');
}

// Every address on the home network(s) this Mac is on, except its own.
// Networks bigger than 1024 addresses (mesh routers) are capped at 1024.
function candidateAddresses() {
  const mine = new Set();
  const targets = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !PRIVATE.test(a.address)) continue;
      mine.add(a.address);
      const ipNum = ipToNum(a.address);
      let maskNum = ipToNum(a.netmask || '255.255.255.0');
      let size = 2 ** 32 - maskNum;
      if (size > 1024) { size = 1024; maskNum = 2 ** 32 - 1024; }
      const network = Math.floor(ipNum / size) * size; // ipNum & maskNum, without 32-bit sign trouble
      for (let h = 1; h < size - 1; h++) targets.add(numToIp(network + h));
    }
  }
  return [...targets].filter((t) => !mine.has(t));
}

function probe(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok ? ip : null); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, ip);
  });
}

async function findSticks({ port = 5555, timeoutMs = 1500, batch = 256, onProgress } = {}) {
  const targets = candidateAddresses();
  const found = [];
  for (let i = 0; i < targets.length; i += batch) {
    const slice = targets.slice(i, i + batch);
    const results = await Promise.all(slice.map((ip) => probe(ip, port, timeoutMs)));
    found.push(...results.filter(Boolean));
    if (onProgress) onProgress(Math.min(i + batch, targets.length), targets.length);
  }
  return { found, range: targets.length ? [targets[0], targets[targets.length - 1]] : null };
}

module.exports = { findSticks, candidateAddresses, IP_RE };
