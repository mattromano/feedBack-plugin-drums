"""Drum Highway backend routes.

POST /api/plugins/drums/midi-log
    The settings screen's MIDI monitor: appends one recording (JSON: summary + raw messages) as a line
    to <config>/drums/midi_log.jsonl. Loopback clients only, 8 MB max.
"""

import json
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse

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


def setup(app, context):
    context = context if isinstance(context, dict) else {}
    config_dir = context.get("config_dir")

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
