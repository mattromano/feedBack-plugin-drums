# Changelog

All notable changes to the Drum Highway plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow `plugin.json`.

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
