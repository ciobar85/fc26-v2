from __future__ import annotations
import json
import os
import traceback
from pathlib import Path
from typing import List

from flask import Flask, jsonify, request, send_from_directory
from models import Player, PackConfig
from pack_generator import generate_pack, filter_pool

# ---------------------------------------------------------------------------
BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DATA_PATH  = BASE_DIR / "data" / "players.json"

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Caricamento database (una volta sola all'avvio)
# ---------------------------------------------------------------------------
def _load() -> List[Player]:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return [Player(**p) for p in json.load(f)]

try:
    PLAYERS: List[Player] = _load()
    print(f"[FC26] Database caricato: {len(PLAYERS)} giocatori", flush=True)
except Exception as exc:
    print(f"[FC26] ERRORE database: {exc}", flush=True)
    PLAYERS = []

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.route("/health")
def health():
    return jsonify({"status": "ok", "players": len(PLAYERS)})


@app.route("/api/pack/config")
def api_config():
    overalls = [p.overall for p in PLAYERS]
    return jsonify({
        "ovr_min_default": 75,
        "ovr_max_default": 82,
        "num_cards_default": 5,
        "db_ovr_min": min(overalls),
        "db_ovr_max": max(overalls),
        "total_players": len(PLAYERS),
    })


@app.route("/api/pack/pool", methods=["POST"])
def api_pool():
    try:
        cfg = PackConfig.from_dict(request.get_json(force=True, silent=True) or {})
        err = cfg.validate()
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"pool_size": len(filter_pool(PLAYERS, cfg))})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/pack/open", methods=["POST"])
def api_open():
    try:
        cfg = PackConfig.from_dict(request.get_json(force=True, silent=True) or {})
        err = cfg.validate()
        if err:
            return jsonify({"error": err}), 400

        pool = filter_pool(PLAYERS, cfg)
        if not pool:
            return jsonify({"error": "Nessun giocatore trovato con i filtri applicati"}), 404
        if len(pool) < cfg.num_cards:
            return jsonify({
                "error": f"Pool insufficiente: {len(pool)} giocatori disponibili, richiesti {cfg.num_cards}"
            }), 400

        pack = generate_pack(PLAYERS, cfg)
        return jsonify({
            "players": [p.to_dict() for p in pack],
            "total_available": len(pool),
        })
    except Exception as exc:
        return jsonify({"error": str(exc), "detail": traceback.format_exc()}), 500


# ---------------------------------------------------------------------------
# FIX: route statica esplicita (NON catch-all generica)
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/static/<path:filename>")
def static_files(filename: str):
    return send_from_directory(str(STATIC_DIR), filename)


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # threaded=True: gestisce più utenti in contemporanea
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
