"""Package the standalone Decky plugin as an installable ZIP."""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
OUTPUT = ROOT / "out" / f"PongBar-v{VERSION}.zip"
REQUIRED = ("main.py", "plugin.json", "package.json", "LICENSE", "README.md", "CHANGELOG.md",
            "docs/CONTROLLER_COMPATIBILITY.md", "assets/MUSIC_CREDITS.md", "dist/index.js")


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        for relative in REQUIRED:
            path = ROOT / relative
            if not path.is_file():
                raise SystemExit(f"Required file is missing: {relative}")
            archive.write(path, Path("PongBar") / relative)
        for path in sorted((ROOT / "py_modules" / "pongbar").rglob("*.py")):
            archive.write(path, Path("PongBar") / path.relative_to(ROOT))
        for path in sorted((ROOT / "dist" / "assets").rglob("*.ogg")):
            archive.write(path, Path("PongBar") / path.relative_to(ROOT))
    print(OUTPUT)


if __name__ == "__main__":
    main()
