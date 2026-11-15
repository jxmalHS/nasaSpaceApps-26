"""
main.py - command-line entry point.

    python main.py run --mission moon_rover_south_pole             # full run (streams what's missing)
    python main.py run --mission moon_rover_south_pole --offline   # only sites already downloaded
    python main.py run --mission moon_rover_south_pole --no-stability
    python main.py export-atlas      # results -> Analog Atlas web app (see atlas_export.py)

Results are written to results/<mission>/ (see docs/pipeline.md).
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path

from pipeline import download_sites, download_temperature, load_config, run_mission

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
    dl = sub.add_parser("download", help="download the next N sites without ranking")
    dl.add_argument("--mission", required=True, choices=sorted(missions))
    dl.add_argument("--count", type=int, default=15)
    dt = sub.add_parser("download-temperature",
                        help="get MODIS temperature (NASA AppEEARS, needs Earthdata login) for downloaded sites")
    dt.add_argument("--mission", required=True, choices=sorted(missions))
    sub.add_parser("export-atlas", help="convert results into the Analog Atlas web app's sparse-score CSV")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if args.command == "export-atlas":
        from atlas_export import export_atlas
        dest = export_atlas(ROOT)
        print(f"Analog Atlas files written to {dest}\nIn the analog-atlas project run:\n"
              f"  python ml/export_scores.py {dest / 'scores.csv'} --card {dest / 'model_card.json'} "
              f"--validation {dest / 'validation.json'}\n  python ml/validate.py\n  npm run build")
        return
    if args.command == "download-temperature":
        done = download_temperature(args.mission, ROOT)
        print(f"Temperature saved for {len(done)} sites.")
        return
    if args.command == "download":
        done = download_sites(args.mission, ROOT, args.count)
        print(f"Downloaded {len(done)} sites. Rank them with: python main.py run --mission {args.mission} --offline")
        return
    out = run_mission(args.mission, ROOT, offline=args.offline, run_stability=not args.no_stability)
    print(f"Done. Results in {out}  (start with report.md and the .png charts)")


if __name__ == "__main__":
    main()
