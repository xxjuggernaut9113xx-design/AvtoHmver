# Documentation portal build

The portal is generated from selected repository Markdown with MkDocs Material. The selected Markdown remains canonical; the build stages copies into a temporary source tree and produces a static site.

## Build locally

From the repository root, install the pinned documentation dependency and build a tagged site:

```sh
python -m pip install -r requirements-docs.txt
python scripts/build-docs.py --tag v0.4.0
```

The build runs MkDocs in strict mode and checks the generated homepage, visible source tag, release link rule, and every curated navigation page. A tag beginning with `v` gets a GitHub Release link. Other valid Git tags do not.

To build a non-version tag or write the output somewhere else inside the repository:

```sh
python scripts/build-docs.py --tag nightly-example --site-dir .test-tmp/docs-nightly
```

MkDocs builds in a temporary directory first. Publishing replaces an existing output only when it contains the portal's `.avtohmver-docs-output` ownership marker; an empty directory is also accepted. The builder rejects paths outside the repository, the repository root, and Git metadata. A successful local build writes the site to `site/` by default.

GitHub Actions uses the same command for each pushed tag, then uploads `site/` to GitHub Pages. Each successful deployment replaces the stable portal with documentation for that tag.
