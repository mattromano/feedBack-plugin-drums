# Changelog

All notable changes to the Drum Highway plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow `plugin.json`.

## 4.7.1

### Added
- **HUD modes.** `feedBackDrums.setScoreHudHidden(canvas, 'score')` hides only the lane's score number, stars and accuracy line (and its end card); the streak, multiplier, score pops, combo rings and milestone bursts, FULL COMBO, the early/late meter, the star power meter, the difficulty badge and the hit effects stay, in the 3D and the 2D view. `true` / `false` work as before. `isScoreHudHidden(canvas)` returns the mode (`true`, `false` or `'score'`), and `hudModes()` returns `['score']`.

### Changed
- With RockHeroSmith adopting a solo play, the main player's drum view keeps its full lane HUD (4.7.0 hid it, which left an almost empty screen). It still skips its end card and `drums_best_v1` best, since RockHeroSmith shows the results.
- Asset version bumped.

## 4.7.0

### Added
- **Play layer APIs for RockHeroSmith** on `window.feedBackDrums`: `midiInput()` (the MIDI input the drums play from, `{ key, name, connected }`) and `whenMidiReady()`; `setPadSound({ muted, volume })` / `getPadSound()` (volume is the saved pad volume; muted silences pads and auto notes, keeping the volume; `window.__drumsMutePads` stays as an alias); `mountQuickSettings(el, { canvas, soundModes, soundMode, onSoundMode })`, the in-song drum settings (difficulty, auto kick / cymbals, pro cymbals or 4-lane, timing window, input offset with the early/late Apply, pad volume, and the Rock Band / Song + pads / Kit only switch when RockHeroSmith passes its sound modes). The ⚙ panel and the quick settings share one set of controls.
- `feedBackDrums.getDifficulty(canvas?)` (the lane's pinned difficulty, else the global one), and `proDrums` (the effective pro cymbals state) in `getInstanceState` and every bus event.
- **`drums:bonus`** on the bus (`{ canvas, points, reason: 'solo' }`) when a drum solo's bonus is paid, so the band score counts it.

### Changed
- With RockHeroSmith adopting solo plays (`rockHeroSmith.adoptsSolo()`), the main player's drum view (`#highway`) shows no score HUD, end card or personal best of its own; RockHeroSmith's HUD and results take over. Split view panels keep theirs. Without it nothing changes.
- **Play as → Drums** plays your MIDI kit or a controller as RockHeroSmith's `soloKindFor` decides (MIDI is discovered first).
- The ⚙ drum settings button sits in core's player rail slot (`feedBack.ui.playerControlSlot()`) when core has one.
- Asset version bumped.

## 4.6.2

### Fixed
- **Easy / Medium / Hard on charts without lower levels.** Picking one on a chart that only has Expert (a legacy "Drums" arrangement encoded as guitar notes, or a drum tab without `levels`) silently played Expert. The missing levels are now generated from Expert when the chart loads, with core's reduction rule (`lib/drumchart_gen.py` `reduce_level`: feedBack's own rules, fitted on 136 hand-authored charts) ported to `session.js` (`reduceLevel`, `withGeneratedLevels`). They are marked as generated (the badge says **AUTO**) and drive scoring, auto kick / cymbals, both views, band lane difficulty and **Play as**. Hand-charted levels in the tab always win. Asset version bumped.

## 4.6.1

### Added
- **Play as** entry for core's library menus (`libraryCardActions`, placement `play-as`): Drums, on any song with a drum chart or a Drums arrangement. It asks for the difficulty first (Easy … Expert+, the saved one focused) and plays on the Drum Highway for that play only; a connected kit or game controller plays it as usual.

### Changed
- The built-in Xbox-style pad layout matches the 5-Fret plugin's colours: blue is now RT and green LT (they were swapped), so one pad plays guitar and drums the same way. Red LB, yellow RB, kick A are unchanged. A layout saved on the controls screen is kept.
- Docs and tests name RockHeroSmith (formerly Build-a-Band; screen `plugin-rockherosmith`).

## 4.6.0

- **Play drums on a controller.** An Xbox-style pad (LB / RB / LT / RT red / yellow / blue / green, A kick,
  Y star power, Start play / pause) or a plastic kit drums through core's gamepad-input domain. The view
  claims it only while a drum part plays, sounds the kit on each hit, and, from its first pad hit in a
  song, plays a controller without cymbals with pro cymbals off. Each controller keeps its own input offset; the timing meter's Apply
  sets it. Nothing changes on a core without the domain.
- **Controllers card on the Drums screen.** Set up a controller as a drum kit (Skip for cymbals / star
  power), pick the gamepad layout, rebind one action, and set a per-controller input offset (−250 to
  250 ms). Pad lights stay silent. While the card is open, the free controller stands down.
- **Band API:** `feedBackDrums.setController(controllerKey, canvas)` / `clearController(canvas)` pin a
  lane to one controller (no kit or keyboard hits there, no personal best; Start and a held Back go out as
  `drums:band-pause` / `drums:band-back-hold`), `listControllers()` and `createMapper(controllerKey)`
  (Promises) and `openControls({ returnTo })`.
- `plugin.json` declares the `gamepad-input` capability. Asset version bumped (new `gamepad.js`,
  `gamepad-source.js`, `gamepad-controls.js`).

## 4.5.3

- **3D view hit / miss effects from the stock feedBack 3D drum highway** (behaviour ported, code written fresh):
  hit gems turn green and missed gems red, keep travelling past the strikeline and fade out over 0.4 s
  instead of vanishing; pooled spark bursts that grow with the streak (spark colour by timing: green on time,
  cyan early, amber late); a green lane flash on a hit and a red one on a miss / overhit; score pops,
  a combo ring every 10, milestone bursts at 25 / 50 / 100 and a red wash when a streak of 3+ breaks.
  Visual only: judgement and scoring are unchanged. Session hit events now also carry `combo`, `offsetMs`
  and `points` for the view. Asset version bumped.

## 4.5.2

- Ship the DRS (DrumGizmo DRSKit 2.1, 13-mic stereo mix) and the 15-mic CrocellKit 1.1 rebuild as sampled kits; both were only built locally before. CC BY 4.0, credited in NOTICE.md. Asset version bumped so browsers drop the old Crocell samples.

## [4.5.1] - Unreleased

Review fixes from the upstream scoring PR (`feature/drums-scoring`, a523ce1), ported onto the 4.5.0 build.

### Fixed
- **Input offset moves the engine's clock too.** The scoring session owns the offset (`createSession`
  `inputOffsetMs`, `setInputOffset`) and subtracts it from `update()`, `hit()` and `activate()` alike.
  Before, only the hits were shifted, so with a positive offset a late-registered hit found its note
  already missed. Changing the offset (settings, Apply, `__drumsSetInputOffset`) reaches live sessions
  and restarts the timing meter.
- **MIDI velocity reaches the engine as velocity / 127.** The engine reads values <= 1 as already
  normalised, so velocity 1 counted as full strength for the accent / ghost bonus.
- **Star power on charts with phrases but no fills**: Enter works with keyboard drumming off too, and an
  optional **Star power pad** (settings, `drums_sp_pad_v1`: hi-hat pedal, ride bell, splash or china)
  activates it from the kit. The HUD hint says how.
- A scoring script that failed to load (or loaded without registering) has its `<script>` element
  removed, so the next init loads it again.

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
