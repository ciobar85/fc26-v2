from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional


@dataclass
class Player:
    id: int
    name: str
    full_name: str
    position: str
    positions_all: str
    overall: int
    potential: int
    age: int
    nationality: str
    club: str
    preferred_foot: str
    weak_foot: int
    skill_moves: int
    work_rate: str
    height_cm: int
    weight_kg: int
    is_gk: bool
    face_url: str
    stats: Dict[str, int]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PackConfig:
    ovr_min: int = 75
    ovr_max: int = 82
    num_cards: int = 5
    include_gk: bool = True
    position_filter: str = ""
    min_stats: Dict[str, int] = field(default_factory=dict)
    excluded_ids: List[int] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "PackConfig":
        # FIX: usa "or {}" e "or []" per gestire null dal JSON
        raw_stats = data.get("min_stats") or {}
        raw_excluded = data.get("excluded_ids") or []
        min_stats = {k: int(v) for k, v in raw_stats.items() if int(v) > 0}
        return cls(
            ovr_min=int(data.get("ovr_min") or 75),
            ovr_max=int(data.get("ovr_max") or 82),
            num_cards=min(max(int(data.get("num_cards") or 5), 1), 20),
            include_gk=bool(data.get("include_gk", True)),
            position_filter=str(data.get("position_filter") or "").strip(),
            min_stats=min_stats,
            excluded_ids=[int(i) for i in raw_excluded],
        )

    def validate(self) -> Optional[str]:
        if not (47 <= self.ovr_min <= 91):
            return "ovr_min fuori range (47-91)"
        if not (47 <= self.ovr_max <= 91):
            return "ovr_max fuori range (47-91)"
        if self.ovr_min > self.ovr_max:
            return "ovr_min deve essere <= ovr_max"
        if not (1 <= self.num_cards <= 20):
            return "num_cards deve essere tra 1 e 20"
        return None
