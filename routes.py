"""Drum Highway backend routes.

GET /api/plugins/drums/kit-mapping
    The e-kit's pad mapping from Clone Hero's active MIDI profile on this computer (read live, so
    remapping the kit in Clone Hero carries over). screen.js uses it as the default MIDI map when no
    Learn map is saved, with the profile's per-note velocity thresholds.

POST /api/plugins/drums/midi-log
    The settings screen's MIDI monitor: appends one recording (JSON: summary + raw messages) as a line
    to <config>/drums/midi_log.jsonl. Loopback clients only, 8 MB max.

GET /api/plugins/drums/native-midi, WS /ws/plugins/drums/midi?id=<n>
    Direct MIDI input (native_midi.py, WinMM, Windows only): the kit's inputs when the browser's Web
    MIDI can't see them (Windows MIDI Service). screen.js registers them as a provider of core's
    midi-input domain. The socket streams {"d": [bytes], "t": perf ms} per message and answers
    {"ping": x} with {"pong": x, "t": perf ms} so the page can map the times onto performance.now().
    Loopback clients only. The device is open only while a socket listens (so other programs can
    have the kit otherwise). On macOS / Linux the list is empty ("available": false) and nothing is
    opened. DRUMS_MIDI_TEST=1 adds a fake input (id 999) and POST /api/plugins/drums/native-midi/inject
    for tests.
"""

import asyncio
import configparser
import importlib.util
import json
import os
import time
from pathlib import Path

from fastapi import Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

_PLUGIN_DIR = Path(__file__).resolve().parent

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
MIDI_LOG_MAX = 8 * 1024 * 1024


def is_loopback(client) -> bool:
    """True for a request / socket from this computer."""
    host = getattr(client, "host", None) if client else None
    return host in LOOPBACK


def append_midi_log(config_dir, body: bytes):
    """Validate a MIDI monitor recording and append it to <config_dir>/drums/midi_log.jsonl.
    Returns the file path, or raises ValueError."""
    if len(body) > MIDI_LOG_MAX:
        raise ValueError("too large")
    data = json.loads(body.decode("utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("log"), list):
        raise ValueError("expected {log: [...]}")
    out_dir = Path(config_dir) / "drums"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "midi_log.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, separators=(",", ":")) + "\n")
    return path


# Clone Hero pro-drums binding names -> this plugin's lane ids (lanes are by colour:
# ride = blue cymbal, crash = green cymbal, tom1/2/3 = yellow/blue/green tom).
_CH_LANES = {
    "Kick Pad": "kick", "Red Pad": "snare",
    "Yellow Pad": "tom1", "Blue Pad": "tom2", "Green Pad": "tom3",
    "Yellow Cymbal": "hihat", "Blue Cymbal": "ride", "Green Cymbal": "crash",
}


def clone_hero_dirs():
    """Folders Clone Hero may keep its settings in (CLONE_HERO_DIR first)."""
    home = Path.home()
    cands = []
    if os.environ.get("CLONE_HERO_DIR"):
        cands.append(Path(os.environ["CLONE_HERO_DIR"]))
    cands += [home / "Documents" / "Clone Hero", home / "OneDrive" / "Documents" / "Clone Hero",
              home / "Clone Hero", home / "Library" / "Application Support" / "Clone Hero"]
    return [d for d in cands if (d / "MIDI Profiles").is_dir()]


def _active_device_names(ch_dir: Path):
    """midi_device_name of each profile in profiles.ini, profile0 first."""
    ini = configparser.ConfigParser(interpolation=None)
    try:
        ini.read(ch_dir / "profiles.ini", encoding="utf-8")
    except (OSError, configparser.Error):
        return []
    names = []
    for sec in sorted(ini.sections()):
        n = ini.get(sec, "midi_device_name", fallback="").strip()
        if n and n not in names:
            names.append(n)
    return names


def parse_ch_midi_profile(text: str):
    """Clone Hero MIDI profile YAML -> (device, {midi: lane_id}, {midi: min_velocity})."""
    import yaml
    data = yaml.safe_load(text) or {}
    mapping, min_vel = {}, {}
    for ch_name, entries in (data.get("Mappings") or {}).items():
        lane = _CH_LANES.get(ch_name)
        if not lane or not isinstance(entries, list):
            continue
        for e in entries:
            try:
                n = int(e.get("NoteNumber"))
            except (TypeError, ValueError, AttributeError):
                continue
            if 0 <= n <= 127 and n not in mapping:
                mapping[n] = lane
                v = e.get("Velocity")
                if isinstance(v, (int, float)) and v > 0:
                    min_vel[n] = int(v)
    return data.get("DeviceName") or "", mapping, min_vel


def find_kit_mapping():
    """The active Clone Hero profile's kit mapping, or {'mapping': None, 'reason': ...}."""
    dirs = clone_hero_dirs()
    if not dirs:
        return {"mapping": None, "reason": "Clone Hero settings folder not found"}
    for d in dirs:
        prof_dir = d / "MIDI Profiles"
        files = sorted(prof_dir.glob("*.yaml"), key=lambda p: p.stat().st_mtime, reverse=True)
        by_name = {f.stem: f for f in files}
        pick = next((by_name[n] for n in _active_device_names(d) if n in by_name), None)
        pick = pick or (files[0] if files else None)
        if pick is None:
            continue
        try:
            device, mapping, min_vel = parse_ch_midi_profile(pick.read_text(encoding="utf-8"))
        except Exception as e:  # malformed YAML etc.
            return {"mapping": None, "reason": f"Could not read {pick.name}: {e}"}
        if mapping:
            return {"mapping": {str(k): v for k, v in sorted(mapping.items())},
                    "min_velocity": {str(k): v for k, v in sorted(min_vel.items())},
                    "device": device or pick.stem, "source": str(pick)}
    return {"mapping": None, "reason": "No Clone Hero MIDI profile with drum mappings"}


_TEST_DEV = 999


class _FakeInput:
    """DRUMS_MIDI_TEST: a stand-in device (messages arrive only through Hub.inject)."""

    def __init__(self, dev_id, listener):
        self.dev_id = dev_id

    def open(self):
        return self

    def close(self):
        pass


def _load_native_midi(context):
    load = context.get("load_sibling")
    if callable(load):
        return load("native_midi")
    spec = importlib.util.spec_from_file_location("drums_native_midi", _PLUGIN_DIR / "native_midi.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def native_midi_routes(app, nm, log=None, test_mode=None):
    if test_mode is None:
        test_mode = os.environ.get("DRUMS_MIDI_TEST") == "1"

    def opener(dev_id, listener):
        if test_mode and dev_id == _TEST_DEV:
            return _FakeInput(dev_id, listener)
        return nm.MidiInput(dev_id, listener)

    hub = nm.Hub(opener)

    def inputs():
        out = nm.list_inputs()
        if test_mode:
            out.append({"id": _TEST_DEV, "name": "Drums test kit"})
        return out

    @app.get("/api/plugins/drums/native-midi")
    def native_midi_list(request: Request):
        if not is_loopback(request.client):
            return JSONResponse({"available": False, "inputs": []}, status_code=403)
        try:
            return {"available": bool(nm.available() or test_mode), "inputs": inputs()}
        except Exception as e:
            return {"available": False, "inputs": [], "error": str(e)}

    if test_mode:
        @app.post("/api/plugins/drums/native-midi/inject")
        async def native_midi_inject(data: dict):
            hub.inject(int(data.get("id", _TEST_DEV)), [int(b) & 0xFF for b in data.get("data", [])][:3])
            return {"ok": True, "t": time.perf_counter() * 1000}

    @app.websocket("/ws/plugins/drums/midi")
    async def native_midi_ws(ws: WebSocket):
        if not is_loopback(ws.client):
            await ws.close(code=4403)
            return
        await ws.accept()
        try:
            dev = int(ws.query_params.get("id", "-1"))
        except ValueError:
            dev = -1
        loop = asyncio.get_running_loop()
        q = asyncio.Queue(maxsize=2000)

        def on_msg(data, t):   # WinMM thread: hop to the event loop
            def put():
                try:
                    q.put_nowait((data, t))
                except asyncio.QueueFull:
                    pass
            loop.call_soon_threadsafe(put)

        try:
            if not (nm.available() or (test_mode and dev == _TEST_DEV)):
                raise OSError("direct MIDI input needs Windows")
            token = hub.subscribe(dev, on_msg)
        except Exception as e:
            await ws.send_text(json.dumps({"error": str(e)}))
            await ws.close()
            return
        if log:
            log.info("direct MIDI input %s opened", dev)
        await ws.send_text(json.dumps({"open": True, "id": dev, "t": time.perf_counter() * 1000}))

        async def sender():
            while True:
                data, t = await q.get()
                await ws.send_text(json.dumps({"d": data, "t": t * 1000}))

        task = asyncio.create_task(sender())
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                if isinstance(msg, dict) and "ping" in msg:
                    await ws.send_text(json.dumps({"pong": msg["ping"], "t": time.perf_counter() * 1000}))
        except (WebSocketDisconnect, ValueError, RuntimeError):
            pass
        finally:
            task.cancel()
            hub.unsubscribe(dev, token)
            if log:
                log.info("direct MIDI input %s closed", dev)

    return hub


def setup(app, context):
    context = context if isinstance(context, dict) else {}
    config_dir = context.get("config_dir")
    log = context.get("log")
    try:
        native_midi_routes(app, _load_native_midi(context), log)
    except Exception as e:   # never block the plugin over the optional MIDI bridge
        if log:
            log.warning("direct MIDI input unavailable: %s", e)

    @app.get("/api/plugins/drums/kit-mapping")
    def drums_kit_mapping(request: Request):
        r = find_kit_mapping()
        if not is_loopback(request.client):
            r.pop("source", None)   # LAN guests get the map, not this computer's file paths
            r.pop("reason", None)
        return r

    @app.post("/api/plugins/drums/midi-log")
    async def drums_midi_log(request: Request):
        if not is_loopback(request.client):
            return JSONResponse({"error": "local only"}, status_code=403)
        if config_dir is None:
            return JSONResponse({"error": "no config dir"}, status_code=500)
        try:
            path = append_midi_log(config_dir, await request.body())
        except (ValueError, UnicodeDecodeError) as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except OSError as e:
            return JSONResponse({"error": str(e)}, status_code=500)
        return {"ok": True, "path": str(path)}
