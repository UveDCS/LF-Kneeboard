"""Genera data/airports.json a partir de pydcs (aeródromos, frecuencias ATC, TACAN y pistas).

Uso: python tools/export_airports.py
También escribe tools/geo_vectors.json con puntos de control para comprobar la proyección en JS.
"""
import json
import os
import random

import dcs.terrain as T
from dcs.mapping import Point

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TERRAINS = [
    T.Caucasus, T.Falklands, T.Germany, T.Kola, T.MarianaIslands, T.Nevada,
    T.Normandy, T.PersianGulf, T.Sinai, T.Syria, T.TheChannel,
]


def mhz(hz):
    return round(hz / 1e6, 3) if hz else None


def main():
    out = {}
    vectors = []
    rnd = random.Random(7)
    for cls in TERRAINS:
        try:
            terrain = cls()
        except Exception as exc:  # pragma: no cover
            print("skip", cls, exc)
            continue
        name = terrain.miz_theatre_name if hasattr(terrain, "miz_theatre_name") else terrain.name
        if callable(name):
            name = name()
        bases = []
        for ap in terrain.airport_list():
            ll = ap.position.latlng()
            radio = getattr(ap, "atc_radio", None)
            runways = []
            for rw in getattr(ap, "runways", []):
                try:
                    runways.append({"name": rw.name, "hdg": [rw.main.heading, rw.opposite.heading]})
                except Exception:
                    pass
            bases.append({
                "id": ap.id,
                "name": ap.name,
                "x": round(ap.position.x, 1),
                "y": round(ap.position.y, 1),
                "lat": round(ll.lat, 6),
                "lon": round(ll.lng, 6),
                "tacan": getattr(ap, "tacan", None),
                "vhf": mhz(radio.vhf_high_hz) if radio else None,
                "uhf": mhz(radio.uhf_hz) if radio else None,
                "runways": runways,
            })
            if len(vectors) < 400 and rnd.random() < 0.3:
                for dx, dy in ((0, 0), (40000, -60000), (-90000, 120000)):
                    p = Point(ap.position.x + dx, ap.position.y + dy, terrain)
                    q = p.latlng()
                    vectors.append({"t": name, "x": p.x, "y": p.y, "lat": q.lat, "lon": q.lng})
        out[name] = sorted(bases, key=lambda b: b["name"])
        print(f"{name}: {len(bases)} aeródromos")
    with open(os.path.join(ROOT, "data", "airports.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(ROOT, "tools", "geo_vectors.json"), "w", encoding="utf-8") as f:
        json.dump(vectors, f)


if __name__ == "__main__":
    main()
