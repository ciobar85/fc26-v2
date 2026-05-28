import eventlet
eventlet.monkey_patch()

import json, os, random, string, traceback
from pathlib import Path
from typing import Dict, List

from flask import Flask, jsonify, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room

from models import Player, PackConfig
from pack_generator import generate_pack, filter_pool

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_PATH  = BASE_DIR / "data" / "players.json"

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet", logger=False, engineio_logger=False)

def _load():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return [Player(**p) for p in json.load(f)]

try:
    PLAYERS = _load()
    print(f"[FC26] {len(PLAYERS)} giocatori caricati", flush=True)
except Exception as e:
    print(f"[FC26] ERRORE: {e}", flush=True)
    PLAYERS = []

# --- Stanze in memoria ---
rooms: Dict[str, dict] = {}

def gen_code():
    chars = string.ascii_uppercase + string.digits
    while True:
        c = "".join(random.choices(chars, k=6))
        if c not in rooms: return c

# --- REST API ---
@app.route("/health")
def health():
    return jsonify({"status": "ok", "players": len(PLAYERS), "rooms": len(rooms)})

@app.route("/api/pack/config")
def api_config():
    ovrs = [p.overall for p in PLAYERS]
    return jsonify({"ovr_min_default":75,"ovr_max_default":82,"num_cards_default":5,
                    "db_ovr_min":min(ovrs),"db_ovr_max":max(ovrs),"total_players":len(PLAYERS)})

@app.route("/api/pack/pool", methods=["POST"])
def api_pool():
    try:
        cfg = PackConfig.from_dict(request.get_json(force=True, silent=True) or {})
        err = cfg.validate()
        if err: return jsonify({"error": err}), 400
        return jsonify({"pool_size": len(filter_pool(PLAYERS, cfg))})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Socket.IO ---
@socketio.on("connect")
def on_connect(): pass

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    for code in list(rooms.keys()):
        room = rooms[code]
        if sid not in room["members"]: continue
        room["members"].discard(sid)
        count = len(room["members"])
        if count == 0:
            del rooms[code]
        else:
            if room["host_sid"] == sid:
                room["host_sid"] = next(iter(room["members"]))
                emit("host_changed", {}, to=code)
            emit("members_updated", {"count": count}, to=code)
        break

@socketio.on("create_room")
def on_create():
    code = gen_code()
    rooms[code] = {"host_sid": request.sid, "pack": [], "revealed": [], "members": {request.sid}}
    join_room(code)
    emit("room_created", {"code": code, "is_host": True, "members": 1})

@socketio.on("join_room_req")
def on_join(data):
    code = str(data.get("code") or "").upper().strip()
    if code not in rooms:
        emit("room_error", {"message": f'Stanza "{code}" non trovata.'})
        return
    rooms[code]["members"].add(request.sid)
    join_room(code)
    is_host = (request.sid == rooms[code]["host_sid"])
    emit("room_joined", {"code": code, "is_host": is_host, "members": len(rooms[code]["members"])})
    emit("members_updated", {"count": len(rooms[code]["members"])}, to=code)
    if rooms[code]["pack"]:
        emit("pack_opened", {"players": rooms[code]["pack"], "revealed": rooms[code]["revealed"]})

@socketio.on("open_pack_live")
def on_open(data):
    code = str(data.get("room_code") or "")
    if code not in rooms: return emit("room_error", {"message": "Stanza non trovata"})
    if rooms[code]["host_sid"] != request.sid: return emit("room_error", {"message": "Solo l'host può aprire pacchetti"})
    try:
        cfg = PackConfig.from_dict(data.get("config") or {})
        err = cfg.validate()
        if err: return emit("room_error", {"message": err})
        pool = filter_pool(PLAYERS, cfg)
        if not pool: return emit("room_error", {"message": "Nessun giocatore trovato"})
        if len(pool) < cfg.num_cards: return emit("room_error", {"message": f"Pool insufficiente: {len(pool)} disponibili"})
        pack = [p.to_dict() for p in generate_pack(PLAYERS, cfg)]
        rooms[code]["pack"] = pack
        rooms[code]["revealed"] = []
        emit("pack_opened", {"players": pack, "revealed": []}, to=code)
    except Exception as e:
        emit("room_error", {"message": str(e)})

@socketio.on("reveal_card_live")
def on_reveal(data):
    code = str(data.get("room_code") or "")
    idx  = int(data.get("index", 0))
    if code not in rooms or rooms[code]["host_sid"] != request.sid: return
    if idx not in rooms[code]["revealed"]: rooms[code]["revealed"].append(idx)
    emit("card_revealed", {"index": idx}, to=code)

@socketio.on("reveal_all_live")
def on_reveal_all(data):
    code = str(data.get("room_code") or "")
    if code not in rooms or rooms[code]["host_sid"] != request.sid: return
    rooms[code]["revealed"] = list(range(len(rooms[code]["pack"])))
    emit("all_revealed", {"total": len(rooms[code]["pack"])}, to=code)

# --- Static ---
@app.route("/")
def index(): return send_from_directory(str(STATIC_DIR), "index.html")

@app.route("/static/<path:filename>")
def static_files(filename): return send_from_directory(str(STATIC_DIR), filename)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
