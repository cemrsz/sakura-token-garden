'use strict';
// Gerçek transcript okumadan, çalışan bir ajanı taklit eden sahte token akışı.
// `npm run demo` ile ağacın birkaç dakikada tam çiçeklenmesini izlemek için.

const { EventEmitter } = require('node:events');

const rand = (min, max) => min + Math.random() * (max - min);

class DemoTracker extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.timer = null;
    this.ready = false;
    this.turn = 0;
  }

  async start() {
    this.ready = true;
    this.emit('ready');
    this.schedule(800);
  }

  stop() {
    clearTimeout(this.timer);
  }

  schedule(delay) {
    this.timer = setTimeout(() => this.tick(), delay);
  }

  tick() {
    this.turn += 1;
    const source = this.turn % 7 === 0 ? 'codex' : 'claude';
    const context = 20_000 + (this.turn % 40) * 2_500;
    const event = {
      ts: Date.now(),
      source,
      session: source === 'claude' ? 'demo-claude' : 'demo-codex',
      project: source === 'claude' ? 'sakura-demo' : 'codex-demo',
      model: source === 'claude' ? 'claude-demo' : 'gpt-demo',
      input: Math.round(rand(2, 900)),
      output: Math.round(rand(150, 1800)),
      cacheWrite: Math.round(rand(500, 7000)),
      cacheRead: Math.round(context),
    };
    this.events.push(event);
    this.emit('events', [event]);
    // Arada bir "düşünme molası" verir ki ağacın dinlenme hâli de görülsün.
    this.schedule(this.turn % 23 === 0 ? rand(6000, 11000) : rand(700, 2200));
  }

  prune(before) {
    this.events = this.events.filter((event) => event.ts >= before);
  }

  info() {
    return {
      claude: { found: true, dirs: ['(demo)'], files: 1, active: 1 },
      codex: { found: true, dirs: ['(demo)'], files: 1, active: 1 },
    };
  }
}

module.exports = { DemoTracker };
