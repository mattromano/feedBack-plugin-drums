"""Drum Highway backend routes.

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
