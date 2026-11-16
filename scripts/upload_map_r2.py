"""Upload a big map to the R2 bucket lunar-navigator-maps, through the API
Worker's multipart route (api-worker/src/index.js), in 50 MB parts.

wrangler can't put objects over 300 MiB, and this needs no R2 API token:
only the Worker's MAPS_KEY. Progress is saved to STATE (default: next to
the map, <map>.upload.json), so rerunning the same command resumes.

    MAPS_KEY=... .venv/bin/python scripts/upload_map_r2.py \
        https://lunar-navigator-api.<subdomain>.workers.dev phase-6/LDEM_80S_20MPP_ADJ.TIF
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

PART = 50 * 1024 * 1024   # R2 needs every part but the last to be the same size
TRIES = 8


def call(method, url, key, body=None):
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"x-maps-key": key, "user-agent": "lunar-navigator-map-upload"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def main(base, name):
    key = os.environ["MAPS_KEY"]
    # SRC uploads a different local file under this name (e.g. a cropped copy).
    path = Path(os.environ.get("SRC") or Path(__file__).resolve().parent.parent / "data" / name)
    state_path = Path(os.environ.get("STATE", f"{path}.upload.json"))
    url = f"{base.rstrip('/')}/_maps-upload/{name}"
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if not state or state.get("part_size") != PART:
        state = {"upload_id": call("POST", url, key)["uploadId"], "part_size": PART, "parts": []}
        state_path.write_text(json.dumps(state))
    size = path.stat().st_size
    total = -(-size // PART)
    with open(path, "rb") as f:
        for n in range(len(state["parts"]) + 1, total + 1):
            f.seek((n - 1) * PART)
            chunk = f.read(PART)
            for attempt in range(TRIES):
                try:
                    part = call("PUT", f"{url}?upload={state['upload_id']}&part={n}", key, chunk)
                    break
                except Exception as e:
                    if attempt == TRIES - 1:
                        raise
                    print(f"  part {n} retry {attempt + 1}: {e}", flush=True)
                    time.sleep(5 * (attempt + 1))
            state["parts"].append(part)
            state_path.write_text(json.dumps(state))
            print(f"  part {n}/{total}", flush=True)
    done = call("POST", f"{url}?upload={state['upload_id']}&complete", key, json.dumps(state["parts"]).encode())
    print(f"done: {done['key']} ({done['size']} bytes, file {size})")
    if done["size"] == size:
        state_path.unlink()


if __name__ == "__main__":
    main(*sys.argv[1:3])
