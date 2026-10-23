"""Read-only build identification. A recognized candidate is NOT a supported mod.

No game execution, injection, installation, save access, or entitlement changes.
"""
import argparse
import hashlib
import json
from pathlib import Path

REGISTRY = Path(__file__).with_name('compatibility.json')
REQUIRED = {'lite_open_and_return_from_original_import', 'synthetic_pack_in_native_unlocks',
            'native_purchase_and_restart', 'streaming_playback', 'original_game_regression_and_uninstall'}


def validate_registry(registry):
    if registry.get('schema') != 1:
        raise ValueError('Unsupported compatibility registry')
    candidates = registry['candidates']
    supported = registry['supported_builds']
    if len({entry['id'] for entry in candidates}) != len(candidates):
        raise ValueError('Duplicate build identity')
    for entry in candidates:
        for relative, digest in entry['files'].items():
            path = Path(relative)
            if relative.startswith('/') or path.is_absolute() or '..' in path.parts or ':' in relative or '\\' in relative:
                raise ValueError('Unsafe build file path')
            if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                raise ValueError('Invalid build hash')
    for build in supported:
        candidate = next((entry for entry in candidates if entry['id'] == build), None)
        if candidate is None or candidate['status'] != 'verified' or not all(candidate['verified'].get(key) is True for key in REQUIRED):
            raise ValueError('Supported build lacks completed native acceptance evidence')
    return registry


def identify(root, registry):
    root = root.resolve(strict=True)
    observed = {}
    for relative in sorted({path for entry in registry['candidates'] for path in entry['files']}):
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Game file resolves outside the supplied installation')
        if path.is_file():
            with path.open('rb') as stream:
                observed[relative] = hashlib.file_digest(stream, 'sha256').hexdigest()
        else:
            observed[relative] = None
    match = next((entry for entry in registry['candidates'] if all(observed.get(path) == digest for path, digest in entry['files'].items())), None)
    return {'recognized': match is not None, 'supported': match is not None and match['id'] in registry['supported_builds'],
            'build_id': match['id'] if match else None, 'files': observed,
            'blockers': match['blockers'] if match else ['Unknown game build; no verified adapter exists.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, help='Windows folder containing CockHero/')
    parser.add_argument('--inspect', action='store_true', help='Identify without requiring mod support')
    args = parser.parse_args()
    registry = validate_registry(json.loads(REGISTRY.read_text(encoding='utf-8')))
    report = identify(args.game_root, registry) if args.game_root else {
        'supported_builds': registry['supported_builds'], 'shipping_ready': bool(registry['supported_builds'])}
    print(json.dumps(report, indent=2))
    if args.game_root and not args.inspect and not report['supported']:
        parser.exit(2, 'No verified fanservice mod adapter supports this installation. No files were changed.\n')


if __name__ == '__main__':
    main()
