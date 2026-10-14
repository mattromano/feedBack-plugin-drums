# Changelog

All notable changes to the Drum Highway plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow `plugin.json`.

## [4.5.0] - Unreleased

Ported from the drums plugin of the earlier Slopsmith 0.2.9 setup (5.9 - 5.18.3).

### Added
- **Hit timing on the audio clock**: a pad hit is timed by its MIDI message's arrival time (the listener's
  timestamp), with the highway's own render offset; keyboard hits by the key event's time.
- **Input grace**: the engine trails the frame clock by 60 ms, so a hit struck before the last frame keeps
  its own time (was moved to the frame: +9 ms late).
- **Frame-exact highway clock** for both views (`window.__hwtFrameTime` when highway tweaks provides it, else
  the 60 Hz sample extrapolated to the draw).
- **Early/late timing meter** in the 3D HUD with a suggested input offset and an Apply button.
- **Calibration hooks**: `drums:judgment` events, `__drumsSetInputOffset`, `__drumsGetConfig`,
  `__drumsRefreshParams`, `__drumsSetPadVolume`, `__drumsCalibrationWindow`, `__drumsMutePads`.
- **Split view**: kit hits reach the drum panel on screen; per-panel difficulty with a picker in the panel
  bar; `window.__drumsPanelResults()`; no single end card in split view.
- **Drum bus**: stereo room (Room setting, default 35 %) with low shelf and presence, no added delay;
  per-piece panning for the GM kits; half the generated room for kits with their own room mics.
- **Balanced, dynamic drum sounds**: one velocity law for every kit, levelled and blended sampled layers,
  per-piece GM levels, darker soft GM hits, natural GM ring length, voice limits; a note the kit has no
  sound for plays its lane's sound; **Velocity curve** setting.
- **DRS** multi-mic kit as an optional kit (built locally with `tools/build_drumgizmo_kit.py`, listed when
  present via `GET /api/plugins/drums/kits`); `tools/kit_loudness.py`, `tools/apply_balance.py`.
- **Hi-hat pedal (CC4)** articulation (semi-open, choke, chick), **Hi-hat pedal** setting.
- Sampled kits are playable once the first hit of every layer is decoded.
- **MIDI monitor** on the settings page, saved to `<config>/drums/midi_log.jsonl` by the new `routes.py`.
- **Direct MIDI input (Windows)**: `native_midi.py` (WinMM) + a loopback WebSocket, registered as a
  midi-input provider; a harmless no-op on macOS / Linux.
- **Clone Hero kit map** (`GET /api/plugins/drums/kit-mapping`) as the default pad map with its velocity
  thresholds; MIDI auto-connect prefers the drum kit over another auto-picked device.
- **One drum highway**: a Drums arrangement in a guitar view is shown on the Drum Highway (main player, per
  song); split view pickers offer Drums once, on the Drum Highway.

### Changed
- Auto kick / cymbals are scheduled from the song's audio clock by one shared, forward-only schedule (were
  ~28 ms late with ±16 ms wobble from the frame clock, ~7 % played twice).
- The drum view no longer reads guitar notes as drums: on a part that isn't drums it says *Pick the Drums
  part* or *This song has no drums*.
- A loaded Drums arrangement with notes plays its chart rather than the sloppak's drum tab.
- GM kits: the pad volume is no longer applied twice.
- A missing sampled kit falls back to the default kit before a GM kit.

## [4.4.0] - Unreleased

### Added
- **Drums settings page** (Plugins → Drums, `screen.html`): every drum setting on one page — difficulty and
  assists, kit with **Play test** and volumes, MIDI input and channel, view, offset, keyboard, 2D options —
  plus a **pad tester** (lights the lane each pad counts as; Learn works there), a **MIDI status** line
  (hits received, last note, why a hit was dropped) and **Reset drum settings**. In sync with the player's
  ⚙ panel, which also gains the MIDI status line.
- **End-of-song card** (#1): final score with bonuses, stars, accuracy, notes hit, best streak / full combo
  and a breakdown of the points; the **best score per song and difficulty** is kept in this browser and
  listed on the settings page.

## [4.3.0] - Unreleased

### Added
- **Drum kits** (#3) — a **Kit** setting with six sounds: two real multi-sampled acoustic kits with velocity
  layers, round-robins and hi-hat chokes — **Crocell** (rock, CC BY 4.0, the new default) and
  **Virtuosity** (jazz, CC0), played by `assets/kits.js` — and four WebAudioFont GM kits (JCLive,
  FluidR3 GM, Sound Blaster Live!, Chaos). `tools/build_sample_kit.py` rebuilds the sampled kits from their
  source libraries.

### Changed
- The drum sounds are bundled in `assets/sounds/` (about 12 MB) instead of loading WebAudioFont from
  surikov.github.io, so the synth works offline and loads nothing from third-party sites.

## [4.2.0] - Unreleased

### Added
- **Rock Band-style 3D drum track** (`assets/highway3d.js`, on core's vendored three.js): pad lanes and a
  kick bar, bevelled rectangle pad gems and domed cymbal gems, rectangular strikeline targets, hit flashes
  and sparks, star power and fill highlighting, drum-solo tint, and a HUD with streak, multiplier, star
  power, score, stars, accuracy and the difficulty badge. Scored by the same session as the 2D view.
- **View** setting — Auto (3D with WebGL2) / 3D / 2D; the main player swaps renderers on change.
  `feedBackViz_drums3d` / `feedBackViz_drums2d` for hosts that want one view.
- **Keyboard drumming** in both views (**Keys**, on by default): B kick, F red, J/K/L toms,
  Shift+J/K/L or U/I/O cymbals, Enter = star power.

## [4.1.0] - Unreleased

### Added
- **Rock Band-style scoring** from a JavaScript port of YARG.Core's drums engine (`assets/engine.js`,
  LGPL-3.0, see `NOTICE.md`): ±70 ms hit window, multiplier up to x4 (x8 in star power), pro-drums
  cymbal/tom lanes, accent/ghost dynamics bonus, stars, and star power with fill activation. Driven
  through `assets/session.js`, which also adds spot-on timing, roll and drum-solo bonuses. The 2D view
  marks hits / misses from the engine and shows a score HUD when **Score** is on.
- **Difficulty per player** — Easy, Medium, Hard, Expert, Expert+ (`drums_difficulty_v1`), from the
  settings panel, the HUD badge or D / Shift+D; Expert drops the double-kick notes. Easier levels, star
  power, fills and solos come from the drum tab's feedpak 1.20.0 gameplay metadata; without it the song
  plays Expert only, without star power.
- **Assists** — auto kick / auto cymbals up to a chosen difficulty (played on the drum sound at their own
  volume), hit-timing presets (Relaxed / Forgiving / Normal / Precision), **Pro cymbals** toggle and an
  input **Offset** (ms) for audio / MIDI latency.

### Changed
- A drum-tab hit is an accent only when the tab marks it (`a`, feedpak 1.20.0) or, for older tabs, when it
  has a written velocity of 100 or more; a hit with no velocity is no longer drawn as an accent. A kick
  marked `x2` is a double kick (GM 35).
- The "Hits" checkbox is now **Score**.
