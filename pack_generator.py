from __future__ import annotations
import random
from typing import Dict, List, Set

from models import Player, PackConfig


def _compute_weights(ovr_range: List[int]) -> Dict[int, float]:
    """
    Pesi geometrici: ogni step di OVR in più raddoppia il peso.
    Esempio range 77-80:  77→1  78→2  79→4  80→8
    Risultato: OVR 80 estratto ~53% delle volte, 77 solo ~7%.
    """
    sorted_range = sorted(ovr_range)
    return {ovr: 2.0 ** rank for rank, ovr in enumerate(sorted_range)}


def _matches(p: Player, config: PackConfig, excluded: Set[int]) -> bool:
    """Applica tutti i filtri al giocatore."""
    if not (config.ovr_min <= p.overall <= config.ovr_max):
        return False
    if not config.include_gk and p.is_gk:
        return False
    if config.position_filter:
        positions = [pos.strip() for pos in p.positions_all.split(',')]
        if config.position_filter not in positions:
            return False
    for stat_key, min_val in config.min_stats.items():
        val = p.stats.get(stat_key)
        if val is None or val < min_val:
            return False
    if p.id in excluded:
        return False
    return True


def filter_pool(all_players: List[Player], config: PackConfig) -> List[Player]:
    """Restituisce il pool disponibile per la config data."""
    excluded: Set[int] = set(config.excluded_ids)
    return [p for p in all_players if _matches(p, config, excluded)]


def generate_pack(all_players: List[Player], config: PackConfig) -> List[Player]:
    """
    Genera un pack senza duplicati con distribuzione pesata:
    OVR più alto = probabilità di estrazione maggiore.
    """
    excluded: Set[int] = set(config.excluded_ids)
    pool = [p for p in all_players if _matches(p, config, excluded)]
    if not pool:
        return []

    # Raggruppa per OVR
    buckets: Dict[int, List[Player]] = {}
    for p in pool:
        buckets.setdefault(p.overall, []).append(p)

    ovr_list = sorted(buckets.keys())
    weights = _compute_weights(ovr_list)
    remaining = {k: list(v) for k, v in buckets.items()}
    selected: List[Player] = []

    for _ in range(config.num_cards):
        available = [o for o in ovr_list if remaining.get(o)]
        if not available:
            break
        w = [weights[o] for o in available]
        chosen_ovr = random.choices(available, weights=w, k=1)[0]
        chosen = random.choice(remaining[chosen_ovr])
        remaining[chosen_ovr].remove(chosen)
        if not remaining[chosen_ovr]:
            del remaining[chosen_ovr]
        selected.append(chosen)

    return selected
