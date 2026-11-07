"""Track configured Cock Hero installs and resolve a verified compatible one.

This registry stores paths only. Compatibility decisions always come from
``verify_compatibility`` and its checked-in compatibility authority.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

try:  # Package import for tests and embedded use.
    from .verify_compatibility import REGISTRY as COMPATIBILITY_REGISTRY
    from .verify_compatibility import identify, validate_registry
except ImportError:  # Direct ``python mod/configured_installs.py`` invocation.
    from verify_compatibility import REGISTRY as COMPATIBILITY_REGISTRY
    from verify_compatibility import identify, validate_registry


def default_registry_path() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "Fanservice" / "configured-games.json"


def load_installs(path: Path) -> list[Path]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    if not isinstance(data, dict) or data.get("schema") != 1 or not isinstance(data.get("installs"), list):
        raise ValueError("Invalid configured game installs registry")
    installs = []
    for entry in data["installs"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not entry["path"].strip():
            raise ValueError("Invalid configured game install entry")
        installs.append(Path(entry["path"]))
    return installs


def save_installs(path: Path, installs: list[Path]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema": 1, "installs": [{"path": str(item)} for item in installs]}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def canonical(path: Path) -> str:
    return os.path.normcase(str(path.expanduser().resolve(strict=False)))


def add_install(registry_path: Path, game_root: Path) -> list[Path]:
    root = game_root.expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Configured game path must be a directory")
    installs = load_installs(registry_path)
    key = canonical(root)
    installs = [item for item in installs if canonical(item) != key]
    installs.append(root)
    save_installs(registry_path, installs)
    return installs


def remove_install(registry_path: Path, game_root: Path) -> list[Path]:
    key = canonical(game_root)
    installs = [item for item in load_installs(registry_path) if canonical(item) != key]
    save_installs(registry_path, installs)
    return installs


def resolve_install(registry_path: Path, compatibility_path: Path = COMPATIBILITY_REGISTRY) -> dict:
    installs = load_installs(registry_path)
    compatibility = validate_registry(json.loads(compatibility_path.read_text(encoding="utf-8")))
    reports = []
    for index, root in enumerate(installs):
        try:
            report = identify(root, compatibility)
        except (OSError, ValueError) as error:
            report = {"recognized": False, "supported": False, "build_id": None,
                      "blockers": [f"Configured game installation is unavailable: {error}"]}
        reports.append({"path": str(root), **report})
    selected = next((index for index in range(len(reports) - 1, -1, -1)
                     if reports[index]["supported"]), None)
    if selected is None:
        return {"selected": None, "fallback": False, "installs": reports,
                "error": "No verified compatible configured game installation is available."
                         " A recognized or older build is not a fallback unless it is listed in supported_builds;"
                         " no compatible fallback was selected."}
    latest = len(reports) - 1
    return {"selected": reports[selected], "fallback": selected != latest,
            "fallback_reason": ("Newest configured installation is not verified compatible."
                                if selected != latest else None),
            "installs": reports}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=default_registry_path(),
                        help="Path to the per-user configured-install registry")
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("add", help="Add or move a game installation to newest")
    add.add_argument("game_root", type=Path)
    remove = commands.add_parser("remove", help="Remove a configured game path")
    remove.add_argument("game_root", type=Path)
    commands.add_parser("list", help="List configured game paths")
    commands.add_parser("resolve", help="Select newest verified compatible configured install")
    args = parser.parse_args(argv)
    try:
        if args.command == "add":
            result = {"installs": [str(path) for path in add_install(args.registry, args.game_root)]}
        elif args.command == "remove":
            result = {"installs": [str(path) for path in remove_install(args.registry, args.game_root)]}
        elif args.command == "list":
            result = {"installs": [str(path) for path in load_installs(args.registry)]}
        else:
            result = resolve_install(args.registry)
            print(json.dumps(result, indent=2))
            return 0 if result["selected"] is not None else 2
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
