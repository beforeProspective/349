const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('D:/code/userfeed/4/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('no script found'); process.exit(1); }
let code = m[1];
code += `
;globalThis.__test = {
  G, ship,
  getAsteroids: () => asteroids,
  getBullets: () => bullets,
  getWells: () => wells,
  getParticles: () => particles,
  getPowerups: () => powerups,
  startGame, deployWell, killAsteroid, spawnWave, saveScore
};`;

// 递归代理：模拟 2D/WebGL 上下文等所有 DOM 对象
const recProxy = new Proxy(function () {}, {
  get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => 0;
    return recProxy;
  },
  set: () => true,
  apply: () => recProxy
});

const listeners = {};
let simTime = 0;
let rafCb = null;
const saved = {};

const sandbox = {
  console,
  performance: { now: () => simTime },
  localStorage: {
    getItem: () => null,
    setItem: (k, v) => { saved[k] = String(v); }
  },
  requestAnimationFrame: (cb) => { rafCb = cb; },
  document: { getElementById: () => recProxy },
  window: {
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1
  }
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const T = sandbox.__test;

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  PASS', msg);
  else { failures++; console.error('  FAIL', msg); }
}
function step(n) {
  for (let i = 0; i < n; i++) {
    simTime += 16.67;
    const cb = rafCb; rafCb = null;
    cb(simTime);
    if (!rafCb) throw new Error('frame did not re-register');
  }
}
function key(code, keyVal, type) {
  for (const fn of listeners[type || 'keydown'] || [])
    fn({ code, key: keyVal || code, repeat: false, preventDefault() {} });
}

console.log('== title ==');
step(60);
assert(T.G.state === 'title', 'starts at title');
assert(T.getAsteroids().length >= 5, 'ambient asteroids present');

console.log('== start game ==');
key('Enter', 'Enter');
assert(T.G.state === 'playing', 'Enter starts game');
assert(T.ship.alive === true, 'ship alive');

console.log('== thrust & fire ==');
key('ArrowUp'); key('Space');
step(30);
assert(T.ship.x !== 512 || T.ship.y !== 384, 'ship moved under thrust');
assert(T.getBullets().length > 0, 'bullets fired');
key('ArrowUp', 'ArrowUp', 'keyup'); key('Space', 'Space', 'keyup');

console.log('== wave spawn ==');
step(200);
assert(T.G.wave >= 1, 'wave started, wave=' + T.G.wave);
assert(T.getAsteroids().length > 0, 'asteroids spawned: ' + T.getAsteroids().length);

console.log('== pause ==');
key('KeyP');
assert(T.G.paused === true, 'paused');
key('KeyP');
assert(T.G.paused === false, 'unpaused');

console.log('== gravity well ==');
key('KeyE');
assert(T.getWells().length === 1, 'well deployed');
assert(T.G.gravCharges === 0, 'charge consumed');
step(30);
assert(T.getParticles().length > 0, 'well particles swirling');
T.getWells()[0].t = 0.01;
step(10);
assert(T.getWells().length === 0, 'well detonated');
assert(T.G.flash > 0 || T.G.shake > 0, 'detonation feedback (flash/shake)');

console.log('== asteroid split ==');
T.spawnWave(5);
const big = T.getAsteroids().find(a => a.size >= 2);
assert(!!big, 'found big asteroid');
if (big) {
  const idx = T.getAsteroids().indexOf(big);
  T.getAsteroids().splice(idx, 1);
  const before = T.getAsteroids().length;
  T.killAsteroid(big);
  assert(T.getAsteroids().length === before + 2, 'split into 2 fragments');
  assert(T.G.score > 0, 'score awarded: ' + T.G.score);
}

console.log('== ship death & respawn ==');
T.ship.invuln = 0;
const ast = T.getAsteroids()[0];
ast.x = T.ship.x; ast.y = T.ship.y; ast.vx = 0; ast.vy = 0;
const livesBefore = T.G.lives;
step(2);
assert(T.ship.alive === false, 'ship destroyed');
assert(T.G.lives === livesBefore - 1, 'life lost');
for (const a of T.getAsteroids()) { a.x = 10; a.y = 10; a.vx = 0; a.vy = 0; }
step(200);
assert(T.ship.alive === true, 'ship respawned');

console.log('== game over & high score ==');
T.G.score = 5000;
for (let k = 0; k < 3; k++) {
  T.ship.invuln = 0;
  const a2 = T.getAsteroids()[0];
  a2.x = T.ship.x; a2.y = T.ship.y; a2.vx = 0; a2.vy = 0;
  step(2);
  for (const a of T.getAsteroids()) { a.x = 10; a.y = 10; a.vx = 0; a.vy = 0; }
  step(200);
}
assert(T.G.state === 'initials', 'initials entry, state=' + T.G.state);

console.log('== initials entry ==');
key('ArrowUp');
assert(T.G.initials[0] === 'B', 'initial changed to B: ' + T.G.initials);
key('Enter', 'Enter');
assert(T.G.state === 'gameover', 'score saved, gameover screen');
assert(T.G.hiscores.some(h => h.name === 'BAA' && h.score === 5000), 'high score recorded');
assert(saved['asteroids-crt-hiscores-v1'] && saved['asteroids-crt-hiscores-v1'].includes('5000'), 'persisted to localStorage');
key('Enter', 'Enter');
assert(T.G.state === 'title', 'back to title');
step(60);

console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
process.exit(failures ? 1 : 0);
