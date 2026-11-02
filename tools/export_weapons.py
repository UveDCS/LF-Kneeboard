"""Genera data/weapons.json (CLSID -> nombre legible) a partir de pydcs, para la tarjeta de vuelo.

Uso: python tools/export_weapons.py
"""
import json
import os

from dcs.weapons_data import Weapons

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    out = {}
    for key in dir(Weapons):
        v = getattr(Weapons, key)
        if isinstance(v, dict) and "clsid" in v and v.get("name"):
            out[v["clsid"]] = v["name"].strip()
    with open(os.path.join(ROOT, "data", "weapons.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} armas")


if __name__ == "__main__":
    main()
