"""
main.py - command-line entry point.

    python main.py run --mission lunar_surface_mobility             # full run (streams what's missing)
    python main.py run --mission lunar_surface_mobility --offline   # only sites already downloaded
    python main.py run --mission lunar_surface_mobility --no-stability

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
    run.add_argument("--offline", action="store_true",
                     help="don't stream: use only sites already saved in data/cache/")
    run.add_argument("--no-stability", action="store_true", help="skip the confidence check (faster)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    out = run_mission(args.mission, ROOT, offline=args.offline, run_stability=not args.no_stability)
    print(f"Done. Results in {out}  (start with report.md)")


if __name__ == "__main__":
    main()
