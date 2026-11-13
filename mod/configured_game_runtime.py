"""Route configured compatible games to their exact-build runtime installer.

This is a thin launcher for the existing ownership-aware installers. It never
chooses a merely recognized build, and install remains review-only unless
``--apply`` is supplied.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

try:
    from . import v004_runtime_installer as v004
    from . import v005_runtime_installer as v005
    from .configured_installs import default_registry_path, load_installs, resolve_install
    from .verify_compatibility import REGISTRY, identify, validate_registry
except ImportError:
    import v004_runtime_installer as v004
    import v005_runtime_installer as v005
    from configured_installs import default_registry_path, load_installs, resolve_install
    from verify_compatibility import REGISTRY, identify, validate_registry

V004_BUILD = v004.packs.TARGET
V005_BUILD = v005.packs.TARGET


def _selected(registry_path: Path, compatibility_path: Path) -> dict:
    resolution = resolve_install(registry_path, compatibility_path)
    selected = resolution.get("selected")
    if selected is None:
        raise ValueError(resolution.get("error", "No verified compatible configured game is available."))
    return selected


def install_selected(registry_path: Path, compatibility_path: Path, loader_archive: Path, *,
                     origin: str | None = None, cef_ready_dll: Path | None = None,
                     apply: bool = False) -> dict:
    selected = _selected(registry_path, compatibility_path)
    game_root = Path(selected["path"])
    build_id = selected.get("build_id")
    if build_id == V004_BUILD:
        # The v0.04 installer has no dry-run mode; status is its non-mutating preflight.
        if apply:
            result = v004.install(game_root, loader_archive, origin=origin)
        else:
            preflight = v004.status(game_root)
            result = {"applied": False, "action": "install", "dry_run": True,
                      "target": str(game_root), "current": preflight}
    elif build_id == V005_BUILD:
        result = v005.install(game_root, loader_archive, origin=origin,
                               cef_ready_dll=cef_ready_dll, apply=apply)
    else:
        raise ValueError(f"No runtime installer is registered for compatible build {build_id!r}.")
    return {"selected": selected, "runtime": result}


def remove_configured(registry_path: Path, compatibility_path: Path, game_root: Path, *,
                      loader_archive: Path | None = None, apply: bool = False) -> dict:
    # Removal may be needed after a game update made the path incompatible, so
    # require a configured, exactly recognized build rather than a supported one.
    installs = load_installs(registry_path)
    requested = game_root.expanduser().resolve(strict=False)
    configured = next((path for path in installs
                       if path.expanduser().resolve(strict=False) == requested), None)
    if configured is None:
        raise ValueError("Choose a game path that is already in the configured installs list.")
    authority = validate_registry(json.loads(compatibility_path.read_text(encoding="utf-8")))
    report = identify(configured, authority)
    build_id = report.get("build_id")
    if build_id == V004_BUILD:
        result = v004.remove(configured) if apply else v004.status(configured)
        if not apply:
            result = {"applied": False, "action": "remove", "dry_run": True,
                      "target": str(configured), "current": result}
    elif build_id == V005_BUILD:
        if loader_archive is None:
            raise ValueError("Removing the v0.05 runtime requires --loader-archive for exact loader verification.")
        result = v005.remove(configured, loader_archive, apply=apply)
    else:
        raise ValueError(f"No safe runtime removal is registered for recognized build {build_id!r}.")
    return {"selected": {"path": str(configured), "build_id": build_id,
                          "supported": bool(report.get("supported"))}, "runtime": result}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=default_registry_path())
    parser.add_argument("--compatibility", type=Path, default=REGISTRY)
    commands = parser.add_subparsers(dest="command", required=True)
    install = commands.add_parser("install", help="Review or install on the newest compatible configured game")
    install.add_argument("--loader-archive", type=Path, required=True)
    install.add_argument("--server-origin")
    install.add_argument("--cef-ready-dll", type=Path)
    install.add_argument("--apply", action="store_true")
    remove = commands.add_parser("remove", help="Review or remove an owned runtime from a configured game")
    remove.add_argument("--game-root", type=Path, required=True)
    remove.add_argument("--loader-archive", type=Path)
    remove.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "install":
            result = install_selected(args.registry, args.compatibility, args.loader_archive,
                                      origin=args.server_origin, cef_ready_dll=args.cef_ready_dll,
                                      apply=args.apply)
        else:
            result = remove_configured(args.registry, args.compatibility, args.game_root,
                                       loader_archive=args.loader_archive, apply=args.apply)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
