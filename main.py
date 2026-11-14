"""
main.py - command-line entry point.

    python main.py run --mission lunar_surface_mobility

Results are written to results/<mission>/ (see docs/pipeline.md).
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path

from pipeline import load_config, run_mission

ROOT = Path(__file__).resolve().parent


def main() -> None:
    _, _, missions = load_config(ROOT)
    parser = argparse.ArgumentParser(description="Find Earth analogs for Moon/Mars terrain")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run one mission end to end")
    run.add_argument("--mission", required=True, choices=sorted(missions))
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    out = run_mission(args.mission, ROOT)
    print(f"Done. Results in {out}")


if __name__ == "__main__":
    main()
