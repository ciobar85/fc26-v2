import json, os, random, string, traceback, unicodedata
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
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading",
                    logger=False, engineio_logger=False)

# ── Database ──────────────────────────────────────────────────────────────────
def _load():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return [Player(**p) for p in json.load(f)]

try:
    PLAYERS: List[Player] = _load()
    print(f"[FC26] {len(PLAYERS)} giocatori caricati", flush=True)
except Exception as e:
    print(f"[FC26] ERRORE: {e}", flush=True)
    PLAYERS = []

# Indice di ricerca normalizzato (costruito una volta sola all'avvio)
def _norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower())
                   if unicodedata.category(c) != "Mn")

SEARCH_IDX: List[tuple] = []          # (nome_normalizzato, player)
_seen_ids: set = set()
for _p in PLAYERS:
    for _raw in [_p.name, _p.full_name]:
        _key = _norm(_raw)
        if _p.id not in _seen_ids:
            SEARCH_IDX.append((_key, _p))
            _seen_ids.add(_p.id)
print(f"[FC26] Indice di ricerca: {len(SEARCH_IDX)} voci", flush=True)

# ── Stanze ────────────────────────────────────────────────────────────────────
# Struttura:
#   rooms[code] = {
#     host_uid:     str,       # UUID del host (persiste tra riconnessioni)
#     host_username: str,
#     pack:         list,
#     revealed:     list[int],
#     members: { uid: {sid|None, username} }
#   }
rooms: Dict[str, dict] = {}

def _gen_code() -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        c = "".join(random.choices(chars, k=6))
        if c not in rooms: return c

def _active_count(room: dict) -> int:
    return sum(1 for m in room["members"].values() if m.get("sid"))

def _member_names(room: dict) -> List[str]:
    return [m["username"] for m in room["members"].values() if m.get("sid")]

# ── REST API ──────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({"status": "ok", "players": len(PLAYERS), "rooms": len(rooms)})

@app.route("/api/pack/config")
def api_config():
    ovrs = [p.overall for p in PLAYERS]
    return jsonify({"ovr_min_default": 75, "ovr_max_default": 82, "num_cards_default": 5,
                    "db_ovr_min": min(ovrs), "db_ovr_max": max(ovrs), "total_players": len(PLAYERS)})

@app.route("/api/pack/pool", methods=["POST"])
def api_pool():
    try:
        cfg = PackConfig.from_dict(request.get_json(force=True, silent=True) or {})
        err = cfg.validate()
        if err: return jsonify({"error": err}), 400
        return jsonify({"pool_size": len(filter_pool(PLAYERS, cfg))})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/players/search")
def api_search():
    q    = _norm(request.args.get("q", "").strip())
    ovr_min = int(request.args.get("ovr_min", 47))
    ovr_max = int(request.args.get("ovr_max", 91))
    if len(q) < 2:
        return jsonify({"players": []})
    results, seen = [], set()
    for norm_name, p in SEARCH_IDX:
        if q in norm_name and p.id not in seen and ovr_min <= p.overall <= ovr_max:
            seen.add(p.id)
            results.append({"id": p.id, "name": p.name, "overall": p.overall,
                             "position": p.position, "club": p.club})
    results.sort(key=lambda x: -x["overall"])
    return jsonify({"players": results[:20]})

# ── Socket.IO ─────────────────────────────────────────────────────────────────
@socketio.on("connect")
def on_connect(): pass

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    for code in list(rooms.keys()):
        room = rooms[code]
        for uid, member in room["members"].items():
            if member.get("sid") == sid:
                member["sid"] = None          # Mantieni lo slot per la riconnessione
                cnt = _active_count(room)
                emit("members_updated", {"count": cnt, "names": _member_names(room)}, to=code)
                # Pulisci se stanza vuota
                if cnt == 0 and all(m.get("sid") is None for m in room["members"].values()):
                    pass   # Mantieni la stanza attiva per la riconnessione dell'host
                return

@socketio.on("create_room")
def on_create(data):
    uid      = str(data.get("uid") or "")
    username = str(data.get("username") or "Host")[:20]
    code = _gen_code()
    rooms[code] = {
        "host_uid":     uid,
        "host_username": username,
        "pack": [], "revealed": [],
        "members": {uid: {"sid": request.sid, "username": username}},
    }
    join_room(code)
    emit("room_created", {"code": code, "is_host": True, "members": 1,
                          "username": username, "names": [username]})

@socketio.on("join_room_req")
def on_join(data):
    code     = str(data.get("code") or "").upper().strip()
    uid      = str(data.get("uid") or "")
    username = str(data.get("username") or "Ospite")[:20]

    if code not in rooms:
        emit("room_error", {"message": f'Stanza "{code}" non trovata.'})
        return

    room = rooms[code]
    # Aggiorna o aggiungi membro (gestisce riconnessione e nuovo ingresso)
    room["members"][uid] = {"sid": request.sid, "username": username}
    join_room(code)

    is_host = (uid == room["host_uid"])
    cnt     = _active_count(room)
    names   = _member_names(room)

    emit("room_joined", {"code": code, "is_host": is_host, "members": cnt,
                         "username": username, "host_username": room["host_username"],
                         "names": names})
    emit("members_updated", {"count": cnt, "names": names}, to=code)

    # Nuovo arrivato riceve lo stato corrente del pack
    if room["pack"]:
        emit("pack_opened", {"players": room["pack"], "revealed": room["revealed"]})

@socketio.on("open_pack_live")
def on_open(data):
    code = str(data.get("room_code") or "")
    uid  = str(data.get("uid") or "")
    if code not in rooms: return emit("room_error", {"message": "Stanza non trovata"})
    if rooms[code]["host_uid"] != uid: return emit("room_error", {"message": "Solo l'host può aprire pacchetti"})
    try:
        cfg  = PackConfig.from_dict(data.get("config") or {})
        err  = cfg.validate()
        if err: return emit("room_error", {"message": err})
        pool = filter_pool(PLAYERS, cfg)
        if not pool: return emit("room_error", {"message": "Nessun giocatore trovato con i filtri"})
        if len(pool) < cfg.num_cards:
            return emit("room_error", {"message": f"Pool insufficiente: {len(pool)} disponibili"})
        pack = [p.to_dict() for p in generate_pack(PLAYERS, cfg)]
        rooms[code]["pack"]     = pack
        rooms[code]["revealed"] = []
        emit("pack_opened", {"players": pack, "revealed": []}, to=code)
    except Exception as e:
        emit("room_error", {"message": str(e)})

@socketio.on("reveal_card_live")
def on_reveal(data):
    code = str(data.get("room_code") or "")
    uid  = str(data.get("uid") or "")
    idx  = int(data.get("index", 0))
    if code not in rooms or rooms[code]["host_uid"] != uid: return
    if idx not in rooms[code]["revealed"]: rooms[code]["revealed"].append(idx)
    emit("card_revealed", {"index": idx}, to=code)

@socketio.on("reveal_all_live")
def on_reveal_all(data):
    code = str(data.get("room_code") or "")
    uid  = str(data.get("uid") or "")
    if code not in rooms or rooms[code]["host_uid"] != uid: return
    rooms[code]["revealed"] = list(range(len(rooms[code]["pack"])))
    emit("all_revealed", {"total": len(rooms[code]["pack"])}, to=code)

# ── Static ────────────────────────────────────────────────────────────────────
@app.route("/")
def index(): return send_from_directory(str(STATIC_DIR), "index.html")

@app.route("/static/<path:filename>")
def static_files(filename): return send_from_directory(str(STATIC_DIR), filename)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False,
                 use_reloader=False, allow_unsafe_werkzeug=True)
