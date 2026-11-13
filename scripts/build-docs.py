"""Build the tagged documentation portal from canonical repository files."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'https://github.com/xxjuggernaut9113xx-design/AvtoHmver'
PAGES = {
    'Project overview': 'README.md',
    'Server installation and operation': 'docs/fanservice/SERVER_DEPLOYMENT.md',
    'Remote access and permissions': 'docs/permissions.md',
    'Release readiness': 'docs/release-beta-gate.md',
    'Parity status': 'docs/parity/STATUS.md',
    'Build and test': 'docs/fanservice/BUILD_WORKFLOW.md',
    'Architecture': 'docs/adr/0005-combined-fanservice-release-gate.md',
    'Packaging and linked archives': 'docs/linked-packages.md',
}
LINK = re.compile(r'(\]\()(<[^>]+>|[^\s)]+)')


def stage(source, destination, tag):
    def resolve(match):
        raw = match[2].removeprefix('<').removesuffix('>')
        url = urlsplit(raw)
        if not url.path or url.scheme or url.netloc or url.path.startswith('/'):
            return match[0]
        target = (ROOT / source).parent.joinpath(unquote(url.path)).resolve()
        if not target.is_relative_to(ROOT):
            return match[0]
        relative = target.relative_to(ROOT).as_posix()
        if relative in PAGES.values():
            return match[0]
        kind = 'tree' if target.is_dir() else 'blob'
        suffix = ('?' + url.query if url.query else '') + ('#' + url.fragment if url.fragment else '')
        return match[1] + f'{REPOSITORY}/{kind}/{quote(tag, safe="")}/{quote(relative)}{suffix}'

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(LINK.sub(resolve, (ROOT / source).read_text(encoding='utf-8-sig')), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--site-dir', type=Path, default=ROOT / 'site')
    args = parser.parse_args()
    subprocess.run(['git', 'check-ref-format', f'refs/tags/{args.tag}'], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix='avtohmver-docs-') as temporary:
        work = Path(temporary)
        docs = work / 'docs'
        for source in PAGES.values():
            destination = 'overview.md' if source == 'README.md' else source
            stage(source, docs / destination, args.tag)
        home = ('# AvtoHmver documentation\n\n'
                f'Built from tag: `{args.tag}`.\n\n'
                'Installation, operation, and contributor guidance for AvtoHmver. '
                'The Server browser interface and API require a running self-hosted Server.\n')
        if args.tag.startswith('v'):
            home += f'\n[Release downloads]({REPOSITORY}/releases/tag/{quote(args.tag, safe="")})\n'
        (docs / 'index.md').write_text(home, encoding='utf-8')
        config = {
            'site_name': f'AvtoHmver documentation ({args.tag})',
            'theme': {'name': 'material'},
            'validation': {'links': {'anchors': 'warn', 'not_found': 'warn'}},
            'nav': [{'Home': 'index.md'}, *[{title: 'overview.md' if path == 'README.md' else path}
                                           for title, path in PAGES.items()]],
        }
        (work / 'mkdocs.yml').write_text(json.dumps(config), encoding='utf-8')
        subprocess.run([sys.executable, '-m', 'mkdocs', 'build', '--strict', '-f',
                        str(work / 'mkdocs.yml'), '-d', str(args.site_dir.resolve())], check=True)


if __name__ == '__main__':
    main()
