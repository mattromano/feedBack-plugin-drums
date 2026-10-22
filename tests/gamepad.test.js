'use strict';
// Tests for gamepad.js (drum controller profiles, mapper, setup recorder, storage).
// Run: node --test tests/gamepad.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const G = require(path.join(__dirname, '..', 'assets', 'gamepad.js'));
const E = require(path.join(__dirname, '..', 'assets', 'engine.js'));

const btn = (index, value, t = 1) => ({ type: 'button', index, value, pressed: value >= 0.5, t });
const axis = (index, value, t = 1) => ({ type: 'axis', index, value, t });

function memoryStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
}
function withStorage(storage, fn) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    try { return fn(); } finally {
        if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
    }
}

test('standard profile maps LB, RB, LT, RT, A to red, yellow, blue, green, kick; Y to star_power; Start to pause', () => {
    const S = G.STANDARD_GAMEPAD;
    assert.equal(S.kind, 'gamepad');
    const expected = { red_pad: 4, yellow_pad: 5, blue_pad: 6, green_pad: 7, kick: 0, star_power: 3, pause: 9 };
    assert.deepEqual(Object.keys(S.map).sort(), Object.keys(expected).sort());
    const m = G.createMapper(S);
    for (const [action, index] of Object.entries(expected)) {
        assert.deepEqual(m.map(btn(index, 1)), [{ action, value: 1 }], action);
        assert.deepEqual(m.map(btn(index, 0)), [{ action, value: 0 }], action);
    }
    assert.deepEqual(G.ACTIONS, ['red_pad', 'yellow_pad', 'blue_pad', 'green_pad', 'kick',
        'yellow_cymbal', 'blue_cymbal', 'green_cymbal', 'star_power', 'pause']);
});

test('PADS match DrumsEngine.PAD', () => {
    const P = E.PAD;
    assert.deepEqual({ ...G.PADS }, {
        red_pad: { pad: P.RED, cymbal: false }, yellow_pad: { pad: P.YELLOW, cymbal: false },
        blue_pad: { pad: P.BLUE, cymbal: false }, green_pad: { pad: P.GREEN, cymbal: false },
        kick: { pad: P.KICK, cymbal: false },
        yellow_cymbal: { pad: P.YELLOW, cymbal: true }, blue_cymbal: { pad: P.BLUE, cymbal: true },
        green_cymbal: { pad: P.GREEN, cymbal: true },
    });
    assert.ok(Object.isFrozen(G.PADS));
});

test('trigger hysteresis: 0.6 presses once, 0.4 holds, 0.2 releases, 0.6 presses again', () => {
    const m = G.createMapper(G.STANDARD_GAMEPAD);
    assert.deepEqual(m.map(btn(6, 0.6)), [{ action: 'blue_pad', value: 1 }]);
    assert.deepEqual(m.map(btn(6, 0.7)), []);
    assert.deepEqual(m.map(btn(6, 0.4)), []);
    assert.deepEqual(m.map(btn(6, 0.2)), [{ action: 'blue_pad', value: 0 }]);
    assert.deepEqual(m.map(btn(6, 0.4)), []);
    assert.deepEqual(m.map(btn(6, 0.6)), [{ action: 'blue_pad', value: 1 }]);
    // reset forgets held state: a trigger held through a disconnect is a fresh press
    m.reset();
    assert.deepEqual(m.map(btn(6, 0.9)), [{ action: 'blue_pad', value: 1 }]);
});

test('standard gamepad has no cymbals; hitFor yellow_cymbal on it is a yellow pad hit', () => {
    assert.equal(G.hasCymbals(G.STANDARD_GAMEPAD), false);
    const withCym = { kind: 'gamepad', map: { ...G.STANDARD_GAMEPAD.map, yellow_cymbal: { type: 'button', index: 1 } } };
    assert.equal(G.hasCymbals(withCym), true);
    assert.deepEqual(G.hitFor('yellow_cymbal', G.STANDARD_GAMEPAD), { pad: E.PAD.YELLOW, cymbal: false });
    assert.deepEqual(G.hitFor('red_pad', G.STANDARD_GAMEPAD), { pad: E.PAD.RED, cymbal: false });
    assert.equal(G.hitFor('star_power', G.STANDARD_GAMEPAD), null);
    assert.equal(G.hitFor('pause', G.STANDARD_GAMEPAD), null);
    assert.equal(G.hitFor('nope', G.STANDARD_GAMEPAD), null);
    assert.equal(G.hitFor('toString', G.STANDARD_GAMEPAD), null);
});

test('a kit binding with yellow_cymbal has cymbals; hitFor gives cymbal true', () => {
    const kit = { kind: 'kit', map: {
        red_pad: { type: 'button', index: 0 }, yellow_pad: { type: 'button', index: 1 },
        yellow_cymbal: { type: 'button', index: 4 } } };
    assert.equal(G.hasCymbals(kit), true);
    assert.deepEqual(G.hitFor('yellow_cymbal', kit), { pad: E.PAD.YELLOW, cymbal: true });
    assert.deepEqual(G.hitFor('yellow_pad', kit), { pad: E.PAD.YELLOW, cymbal: false });
    assert.equal(G.hasCymbals(null), false);
});

test('stored binding beats standard; unknown non-standard controller needs setup', () => {
    const stored = { kind: 'kit', map: { red_pad: { type: 'button', index: 2 } } };
    assert.equal(G.resolveBinding({ mapping: 'standard' }, stored), stored);
    assert.equal(G.resolveBinding({ mapping: 'standard' }, null), G.STANDARD_GAMEPAD);
    assert.equal(G.resolveBinding({ mapping: '' }, null), null);
    assert.equal(G.resolveBinding(null, undefined), null);
    assert.equal(G.controllerKey({ id: 'Pad' }, 2), 'Pad#2');
    assert.equal(G.controllerKey({ id: 'Pad' }), 'Pad#1');
    assert.equal(G.controllerKey({}), null);
});

test('setup walks the kit actions; skip leaves a cymbal unbound; a duplicate control is ignored; a hat value is recorded by value', () => {
    assert.deepEqual(G.SETUP_ACTIONS.kit, G.ACTIONS);
    assert.deepEqual(G.SETUP_ACTIONS.gamepad, ['red_pad', 'yellow_pad', 'blue_pad', 'green_pad', 'kick', 'star_power', 'pause']);
    assert.deepEqual(G.OPTIONAL_ACTIONS, ['yellow_cymbal', 'blue_cymbal', 'green_cymbal', 'star_power']);

    const r = G.createSetupRecorder(['red_pad', 'yellow_pad', 'yellow_cymbal', 'blue_cymbal', 'kick']);
    assert.equal(r.next, 'red_pad');
    let res = r.feed(btn(3, 1, 1));
    assert.deepEqual(res.recorded, { action: 'red_pad', spec: { type: 'button', index: 3 } });
    assert.equal(res.next, 'yellow_pad');
    r.feed(btn(3, 0, 2));
    // pressing the same control again is ignored
    assert.equal(r.feed(btn(3, 1, 3)).recorded, null);
    r.feed(btn(3, 0, 4));
    res = r.feed(btn(5, 1, 5));
    assert.equal(res.recorded.action, 'yellow_pad');
    r.feed(btn(5, 0, 6));
    assert.equal(r.next, 'yellow_cymbal');
    res = r.skip();           // leave yellow_cymbal unbound
    assert.equal(res.next, 'blue_cymbal');
    // a hat value: axis rests at 3.2857, a direction is recorded by value
    r.feed(axis(9, 3.2857, 7));
    res = r.feed(axis(9, -1, 8));
    assert.deepEqual(res.recorded, { action: 'blue_cymbal', spec: { type: 'axis', index: 9, value: -1, tolerance: 0.1 } });
    r.feed(axis(9, 3.2857, 9));
    res = r.feed(btn(0, 1, 10));
    assert.equal(res.done, true);
    assert.deepEqual(res.binding.map, {
        red_pad: { type: 'button', index: 3 }, yellow_pad: { type: 'button', index: 5 },
        blue_cymbal: { type: 'axis', index: 9, value: -1, tolerance: 0.1 }, kick: { type: 'button', index: 0 },
    });
    assert.equal('yellow_cymbal' in res.binding.map, false);
    // the hat value maps back as a 1/0 press
    const m = G.createMapper(res.binding);
    assert.deepEqual(m.map(axis(9, -1)), [{ action: 'blue_cymbal', value: 1 }]);
    assert.deepEqual(m.map(axis(9, 3.2857)), [{ action: 'blue_cymbal', value: 0 }]);
    // a control used by another action (opts.used) is ignored
    const r2 = G.createSetupRecorder(['kick'], { used: [{ type: 'button', index: 1 }] });
    assert.equal(r2.feed(btn(1, 1)).recorded, null);
    assert.equal(r2.feed(btn(2, 1, 2)).recorded.action, 'kick');
});

test('setup ignores a second newly pressed control with the same ev.t as the press it just accepted', () => {
    const r = G.createSetupRecorder(['red_pad', 'yellow_pad']);
    // colour + flag arriving in one poll (same t): only the first binds
    assert.equal(r.feed(btn(1, 1, 5)).recorded.action, 'red_pad');
    const res = r.feed(btn(8, 1, 5));
    assert.equal(res.recorded, null);
    assert.equal(res.next, 'yellow_pad');
    // that ignored press is still held, so it can't bind later without a release...
    assert.equal(r.feed(btn(8, 1, 6)).recorded, null);
    // ...and a press at a later t binds normally
    r.feed(btn(8, 0, 7));
    assert.equal(r.feed(btn(8, 1, 8)).recorded.action, 'yellow_pad');
});

test('controllerName trims to 24 and numbers the second identical controller', () => {
    assert.equal(G.controllerName('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', 1), 'Xbox 360 Controller');
    assert.equal(G.controllerName('  Rock Band Drums  ', 2), 'Rock Band Drums 2');
    assert.equal(G.controllerName('A very long controller name indeed', 1), 'A very long controller n');
    assert.equal(G.controllerName('A very long controller name indeed', 3).length, 26);
    assert.equal(G.controllerName('Pad', 0), 'Pad');
});

test('storage survives a throwing localStorage; setOffset merges per key', () => {
    const thrower = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
    withStorage(thrower, () => {
        assert.deepEqual(G.loadBindings(), {});
        assert.deepEqual(G.loadSettings(), { offsetMs: {} });
        assert.equal(G.saveBinding('a#1', { kind: 'kit', map: {} }), false);
        assert.equal(G.forgetBinding('a#1'), true);
        assert.deepEqual(G.setOffset('a#1', 10), { offsetMs: { 'a#1': 10 } });
    });
    withStorage(memoryStorage(), () => {
        const binding = { kind: 'kit', map: { red_pad: { type: 'button', index: 1 } } };
        assert.equal(G.saveBinding('a#1', binding), true);
        G.saveBinding('b#1', G.STANDARD_GAMEPAD);
        assert.deepEqual(G.loadBindings()['a#1'], binding);
        G.forgetBinding('a#1');
        assert.deepEqual(Object.keys(G.loadBindings()), ['b#1']);
        G.setOffset('a#1', 20);
        assert.deepEqual(G.setOffset('b#1', -35), { offsetMs: { 'a#1': 20, 'b#1': -35 } });
        assert.deepEqual(G.loadSettings(), { offsetMs: { 'a#1': 20, 'b#1': -35 } });
        globalThis.localStorage.setItem(G.SETTINGS_KEY, '{"offsetMs":{"x":"bad","y":5}}');
        assert.deepEqual(G.loadSettings(), { offsetMs: { y: 5 } });
    });
    assert.equal(G.BINDINGS_KEY, 'drums.gamepad.bindings.v1');
    assert.equal(G.SETTINGS_KEY, 'drums.gamepad.settings.v1');
});
