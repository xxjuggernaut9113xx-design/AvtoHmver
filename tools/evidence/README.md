# Evidence parser (session copy, 2026-11-11)

`uasset.py` reads UE5 legacy `.uasset`/`.uexp` packages (name table,
exports, CDO properties). `kismet2.py` parses Kismet bytecode from a
package's script export, tracking storage and iCode offsets and
recording FinalFunction calls (e.g. UpdateMetric) with iCode offsets.
Validated against the v0.05.1 Hotfix legacy-converted packages
(`.uasset`/`.uexp` pairs, not the Zen-format unpacked output):
UI_Manager 704 stmts, BP_GlobalManager 2569 stmts, 0 errors. Use:
`python3 -c "import sys; sys.path.insert(0,'tools/evidence');
import uasset, kismet2; pkg = uasset.Package('<asset>.uasset')"`,
then `kismet2.parse_script(script_bytes, pkg)`.
