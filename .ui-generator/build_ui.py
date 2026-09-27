#!/usr/bin/env python3
"""Restructure desktop/ui/main.slint to the reference layout.

Keeps every existing property/callback declaration (lib.rs compatibility),
moves Player/Feed/Review/GOON/Slideshow/Wall/Cock Hero into a stage overlay,
and rebuilds Library/Discover/Organization/Activity around a sidebar + top bar.
"""
import re
import sys

SRC = "/tmp/main.slint.bak"
DST = "/home/hatch/workspace/curator-rs/desktop/ui/main.slint"

with open(SRC) as f:
    lines = f.readlines()

def find_marker(pattern, start=0):
    rx = re.compile(pattern)
    for i in range(start, len(lines)):
        if rx.search(lines[i]):
            return i
    raise RuntimeError(f"marker not found: {pattern}")

def extract_block(start_idx):
    """Extract from lines[start_idx] through its matching closing brace.
    Returns (text, end_idx_exclusive). Skips braces inside double-quoted strings."""
    depth = 0
    in_str = False
    esc = False
    out = []
    for i in range(start_idx, len(lines)):
        line = lines[i]
        out.append(line)
        for ch in line:
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
        if depth == 0 and out:
            # must have seen at least one open brace
            if any("{" in l for l in out):
                return "".join(out), i + 1
    raise RuntimeError("unbalanced braces")

# ---- section markers ----
ws = {}
for n in range(9):
    ws[n] = find_marker(rf"^        if root\.workspace == {n}:")
settings_marker = find_marker(r"^    // Settings has its own scroll area")
settings_if = find_marker(r"^    if root\.settings-open:", settings_marker)
setup_marker = find_marker(r"^    // First-run setup gate")
setup_if = find_marker(r"^    if root\.setup-required:", setup_marker)
status_line_idx = find_marker(r'^        Text \{ text: root\.status;')

# property block: from workspace prop to grid-columns private prop
prop_start = find_marker(r"^    in-out property <int> workspace: 0;")
prop_end = find_marker(r"^    private property <int> grid-columns")
cb_start = find_marker(r"^    callback open-settings\(\);")
cb_end = find_marker(r"^    callback save-settings\(\) -> bool;")
bg_idx = find_marker(r"^    background: root\.theme-background;")

# library sub-blocks
lib_table_header_idx = find_marker(r'if root\.settings-layout == "table": HorizontalBox \{')
lib_scroll_idx = find_marker(r"content-y <=> root\.library-scroll-y;")
# the ScrollView line is the line before content-y
while "ScrollView" not in lines[lib_scroll_idx]:
    lib_scroll_idx -= 1
lib_inspector_idx = find_marker(r"content-y <=> root\.inspector-scroll-y;")
while "ScrollView" not in lines[lib_inspector_idx]:
    lib_inspector_idx -= 1

out = []
A = out.append

# ---- head: imports, structs, tray ----
A(''.join(lines[0:6]))
A('export struct NavRow { label: string, count: string, is-group: bool, depth: int }\n')
A('export struct GroupCard { name: string, detail: string }\n')
A('export struct ProviderRow { name: string, detail: string, enabled: bool, locked: bool }\n')
A('\n')
# CuratorTray: lines[6:19]
tray_start = find_marker(r"^export component CuratorTray")
tray_end = find_marker(r"^export component CuratorNativeWindow")
A(''.join(lines[tray_start:tray_end]))
A('\n')

# ---- window header ----
A('export component CuratorNativeWindow inherits Window {\n')
A('    title: (root.local-host ? "Curator Host" : "Curator Viewer") + " — " + (root.stage-open ? ("Stage — " + (root.stage-mode == 0 ? "Player" : root.stage-mode == 1 ? "Feed" : root.stage-mode == 2 ? "Review" : root.stage-mode == 3 ? "GOON" : root.stage-mode == 4 ? "Slideshow" : root.stage-mode == 5 ? "Portrait Wall" : "Cock Hero")) : (root.workspace == 0 ? root.location-title : root.workspace == 1 ? "Discover" : root.workspace == 2 ? "Organization" : "Activity"));\n')
A('    preferred-width: 1200px; preferred-height: 800px;\n')
A('    min-width: 800px; min-height: 560px;\n')

# ---- existing properties verbatim ----
A(''.join(lines[prop_start:prop_end + 1]))

# ---- new properties ----
A('    in-out property <[NavRow]> nav-rows;\n')
A('    in-out property <[GroupCard]> group-cards;\n')
A('    in-out property <[ProviderRow]> provider-list;\n')
A('    in-out property <string> download-summary;\n')
A('    in-out property <bool> stage-open: false;\n')
A('    in-out property <int> stage-mode: 0;\n')
A('    in-out property <string> menu-open: "";\n')
A('    in-out property <bool> show-diagnostics: false;\n')

# ---- existing callbacks verbatim + new ----
A(''.join(lines[cb_start:cb_end + 1]))
A('    callback provider-toggled(int, bool);\n')
A('    callback browse-group(int);\n')
A('    callback quit-window();\n')

A(lines[bg_idx])
A('\n')

# ============ BODY ============
A('    root-rect := Rectangle {\n')
A('        main-ui := VerticalBox {\n')
A('            padding: 16px; spacing: 12px;\n')
# ---- top bar ----
A('            top-bar := HorizontalBox {\n')
A('                spacing: 6px; min-height: 40px; max-height: 40px; vertical-stretch: 0;\n')
A('                Button { text: "File"; clicked => { root.menu-open = root.menu-open == "file" ? "" : "file"; } }\n')
A('                Button { text: "Tools"; clicked => { root.menu-open = root.menu-open == "tools" ? "" : "tools"; } }\n')
A('                Rectangle { width: 10px; }\n')
A('                ScrollView { horizontal-stretch: 1; vertical-stretch: 0;\n')
A('                    tab-strip := HorizontalBox { spacing: 6px;\n')
A('                        for label[index] in ["Library", "Discover", "Organization", "Activity"]: Button {\n')
A('                            text: label; primary: root.workspace == index && !root.stage-open;\n')
A('                            clicked => { root.workspace = index; root.stage-open = false; root.menu-open = ""; }\n')
A('                        }\n')
A('                        for label[index] in ["Player", "Feed", "Review", "GOON", "Slideshow", "Portrait Wall", "Cock Hero"]: Button {\n')
A('                            text: label; primary: root.stage-open && root.stage-mode == index;\n')
A('                            clicked => { root.stage-mode = index; root.stage-open = true; root.menu-open = ""; }\n')
A('                        }\n')
A('                        Button { text: "Settings"; clicked => { root.menu-open = ""; root.stage-open = false; root.open-settings(); } }\n')
A('                    }\n')
A('                }\n')
A('                if !root.local-host: Button { text: "Switch Host"; clicked => { root.switch-host(); } }\n')
A('            }\n')
A('            if root.connection-status != "": Text { text: root.connection-status; wrap: word-wrap; color: #ff8a80; font-size: 12px; }\n')
# ---- sidebar + content ----
A('            HorizontalBox {\n')
A('                spacing: 0; vertical-stretch: 1;\n')
A('                sidebar := VerticalBox {\n')
A('                    width: 232px; spacing: 10px; padding: 4px;\n')
A('                    HorizontalBox { spacing: 8px;\n')
A('                        Rectangle { width: 34px; height: 34px; background: root.theme-accent; border-radius: 8px;\n')
A('                            Text { text: "C"; color: #ffffff; font-weight: 700; font-size: 18px; horizontal-alignment: center; vertical-alignment: center; }\n')
A('                        }\n')
A('                        VerticalBox { spacing: 0;\n')
A('                            Text { text: "CURATOR"; font-size: 14px; font-weight: 700; color: root.theme-text; }\n')
A('                            Text { text: "/ " + (root.workspace == 0 ? "LIBRARY" : root.workspace == 1 ? "DISCOVER" : root.workspace == 2 ? "ORGANIZATION" : "ACTIVITY"); font-size: 11px; color: root.theme-muted; }\n')
A('                        }\n')
A('                    }\n')
A('                    Button { text: "+ Add source"; primary: true; clicked => { root.workspace = 2; } }\n')
A('                    Text { text: "SOURCE HIERARCHY"; font-size: 11px; font-weight: 700; color: root.theme-muted; }\n')
A('                    ScrollView { vertical-stretch: 1;\n')
A('                        VerticalBox { spacing: 2px;\n')
A('                            nav-all := TouchArea { clicked => { root.navigate(-1); } mouse-cursor: pointer;\n')
A('                                Rectangle { background: nav-all.has-hover ? root.theme-selection : #00000000; border-radius: 6px;\n')
A('                                    HorizontalBox { padding-left: 8px; padding-top: 5px; padding-bottom: 5px;\n')
A('                                        Text { text: "All sources and groups"; color: nav-all.has-hover ? root.theme-selection-text : root.theme-text; vertical-alignment: center; }\n')
A('                                    }\n')
A('                                }\n')
A('                            }\n')
A('                            for row[idx] in root.nav-rows: nav-touch := TouchArea { clicked => { root.navigate(idx); } mouse-cursor: pointer;\n')
A('                                Rectangle { background: nav-touch.has-hover ? root.theme-selection : #00000000; border-radius: 6px;\n')
A('                                    HorizontalBox { padding-left: 8px + row.depth * 14px; padding-top: 5px; padding-bottom: 5px;\n')
A('                                        Text { text: (row.is-group ? "▸ " : "• ") + row.label + " (" + row.count + ")"; color: nav-touch.has-hover ? root.theme-selection-text : root.theme-text; font-weight: row.is-group ? 700 : 400; overflow: elide; vertical-alignment: center; }\n')
A('                                    }\n')
A('                                }\n')
A('                            }\n')
A('                        }\n')
A('                    }\n')
A('                }\n')
A('                Rectangle { width: 1px; background: root.theme-line; }\n')
A('                content := VerticalBox {\n')
A('                    horizontal-stretch: 1; padding-left: 16px; spacing: 12px;\n')

# ============ LIBRARY (workspace 0) ============
A('                    if root.workspace == 0: VerticalBox { spacing: 12px;\n')
A('                        Text { text: "LIBRARY"; font-size: 11px; font-weight: 700; color: root.theme-muted; }\n')
A('                        HorizontalBox { spacing: 8px;\n')
A('                            Text { text: "All Media"; font-size: 24px; font-weight: 700; horizontal-stretch: 1; vertical-alignment: center; color: root.theme-text; }\n')
A('                            Button { text: "+ Add source"; clicked => { root.workspace = 2; } }\n')
A('                            if root.local-host: Button { text: "Import folder"; enabled: !root.busy; clicked => { root.import-folder(); } }\n')
A('                            LineEdit { placeholder-text: "Search library"; text <=> root.filter-search; min-width: 110px; horizontal-stretch: 1; }\n')
A('                            Button { text: "Play · Mobile Feed"; primary: true; enabled: root.can-playback; clicked => { root.stage-mode = 0; root.stage-open = true; } }\n')
A('                        }\n')
A('                        HorizontalBox { spacing: 8px; \n')
A('                            Button { text: "Grid"; primary: root.settings-layout == "grid"; clicked => { root.settings-layout = "grid"; } }\n')
A('                            Button { text: "Table"; primary: root.settings-layout == "table"; clicked => { root.settings-layout = "table"; } }\n')
A('                            ComboBox { model: ["All media", "image", "clip", "video"]; current-value <=> root.filter-kind; min-width: 100px; horizontal-stretch: 1; }\n')
A('                            ComboBox { model: ["date_desc", "date_asc", "filename_asc", "filename_desc", "rating_desc", "rating_asc", "size_desc", "size_asc", "shuffle"]; current-value <=> root.filter-sort; min-width: 100px; horizontal-stretch: 1; }\n')
A('                            ComboBox { model: ["all", "unrated", "auto", "needs_review", "reviewed"]; current-value <=> root.filter-review; min-width: 100px; horizontal-stretch: 1; }\n')
A('                            ComboBox { model: ["Any rating", "0", "1", "2", "3", "4", "5"]; current-value <=> root.filter-rating; min-width: 90px; horizontal-stretch: 1; }\n')
A('                            LineEdit { placeholder-text: "All tags (comma separated)"; text <=> root.filter-all-tags; horizontal-stretch: 1; }\n')
A('                        }\n')
A('                        HorizontalBox { spacing: 8px; \n')
A('                            LineEdit { placeholder-text: "Tag"; text <=> root.filter-tag; min-width: 62px; horizontal-stretch: 1; }\n')
A('                            LineEdit { placeholder-text: "Creator"; text <=> root.filter-creator; min-width: 62px; horizontal-stretch: 1; }\n')
A('                            LineEdit { placeholder-text: "Any tags"; text <=> root.filter-any-tags; min-width: 62px; horizontal-stretch: 1; }\n')
A('                            LineEdit { placeholder-text: "Exclude tags"; text <=> root.filter-exclude-tags; min-width: 62px; horizontal-stretch: 1; }\n')
A('                            LineEdit { placeholder-text: "Min bytes"; text <=> root.filter-min-size; min-width: 62px; horizontal-stretch: 1; }\n')
A('                            LineEdit { placeholder-text: "Max bytes"; text <=> root.filter-max-size; min-width: 62px; horizontal-stretch: 1; }\n')
A('                            CheckBox { text: "Unknown size"; checked <=> root.filter-unknown-size; }\n')
A('                        }\n')
A('                        HorizontalBox { spacing: 8px; \n')
A('                            Button { text: "Select all"; enabled: !root.busy; clicked => { root.select-all(); } }\n')
A('                            Button { text: "Clear"; enabled: !root.busy && root.selected-count > 0; clicked => { root.clear-selection(); } }\n')
A('                            Rectangle { horizontal-stretch: 1; }\n')
A('                            Button { text: "Search / refresh"; enabled: !root.busy; clicked => { root.browse(false); } }\n')
A('                            Button { text: "Previous page"; enabled: !root.busy && root.has-previous; clicked => { root.previous-page(); } }\n')
A('                            Button { text: "Next page"; enabled: !root.busy && root.has-more; clicked => { root.browse(true); } }\n')
A('                        }\n')
A('                        HorizontalBox { spacing: 12px; vertical-stretch: 1;\n')
A('                            VerticalBox { horizontal-stretch: 3; spacing: 8px;\n')
# table header (verbatim, reindented content is fine)
tbl_hdr, _ = extract_block(lib_table_header_idx)
A(tbl_hdr)
# media scroll (verbatim)
A('                                ScrollView {\n')
A('                                    vertical-stretch: 1;\n')
A('                                    content-y <=> root.library-scroll-y;\n')
# extract inner of the scrollview: table body + grid body. Drop the
# ScrollView { line plus its property lines (through content-y).
scroll_text, scroll_end = extract_block(lib_scroll_idx)
scroll_lines = scroll_text.split("\n")
drop = 1
while "content-y" not in scroll_lines[drop]:
    drop += 1
drop += 1
scroll_inner = "\n".join(scroll_lines[drop:]).rsplit("\n", 2)[0]
# patch grid card: move checkbox to top-left row like the reference
scroll_inner = scroll_inner.replace(
    'VerticalBox {\n                                    padding: 8px; spacing: 5px;\n                                    Image { source: entry.thumbnail; height: 64px; visible: entry.has-thumbnail; image-fit: contain; }\n                                    CheckBox { text: "Select"; checked: entry.selected; toggled => { root.select-item(index, self.checked); } }',
    'VerticalBox {\n                                    padding: 8px; spacing: 5px;\n                                    HorizontalBox { CheckBox { checked: entry.selected; toggled => { root.select-item(index, self.checked); } } Rectangle { horizontal-stretch: 1; } }\n                                    Image { source: entry.thumbnail; height: 64px; visible: entry.has-thumbnail; image-fit: contain; }')
A(scroll_inner + "\n")
A('                                }\n')
A('                            }\n')
# inspector (verbatim), only when something is selected
insp_text, _ = extract_block(lib_inspector_idx)
insp_text = insp_text.replace("root.workspace = 1;", "root.stage-mode = 0; root.stage-open = true;")
A('                            if root.selected-count > 0: ScrollView {\n')
A('                                horizontal-stretch: 1; min-width: 250px; max-width: 330px;\n')
A('                                content-y <=> root.inspector-scroll-y;\n')
insp_lines = insp_text.split("\n")
drop = 1
while "content-y" not in insp_lines[drop]:
    drop += 1
drop += 1
insp_inner = "\n".join(insp_lines[drop:]).rsplit("\n", 2)[0]
A(insp_inner + "\n")
A('                            }\n')
A('                        }\n')
A('                    }\n')

# ============ DISCOVER (workspace 1) ============
A('                    if root.workspace == 1: ScrollView { vertical-stretch: 1; content-y <=> root.manage-discover-scroll-y;\n')
A('                        VerticalBox { spacing: 12px;\n')
A('                            Text { text: "DISCOVER"; font-size: 11px; font-weight: 700; color: root.theme-muted; }\n')
A('                            Text { text: "Search"; font-size: 24px; font-weight: 700; color: root.theme-text; }\n')
A('                            Text { text: "Find public media across every connected provider. Queue the hits you want and Curator downloads them."; wrap: word-wrap; color: root.theme-muted; }\n')
A('                            HorizontalBox { spacing: 8px;\n')
A('                                LineEdit { placeholder-text: "Find collections, creators, or a page URL"; text <=> root.manage-discovery-query; horizontal-stretch: 1; }\n')
A('                                ComboBox { model: ["Any type", "album", "creator", "collection", "post"]; current-index: 0; selected => { root.discovery-result-type = self.current-index == 0 ? "" : self.current-value; } }\n')
A('                                ComboBox { model: ["relevance", "date_desc", "date_asc"]; current-index: 0; selected => { root.discovery-sort = self.current-value; } }\n')
A('                                Button { text: "Search"; primary: true; enabled: root.can-discover && !root.busy && !root.discovery-searching; clicked => { root.discover(root.manage-discovery-query, 0, root.discovery-result-type, root.discovery-sort); } }\n')
A('                                if root.discovery-searching: Button { text: "Cancel"; clicked => { root.cancel-discover(); } }\n')
A('                            }\n')
A('                            Text { text: "Providers"; font-size: 16px; font-weight: 700; color: root.theme-text; }\n')
A('                            GridLayout { spacing: 8px;\n')
A('                                for provider[idx] in root.provider-list: VerticalBox {\n')
A('                                    row: idx / 3; col: Math.mod(idx, 3);\n')
A('                                    CheckBox { text: provider.name; checked: provider.enabled; enabled: !provider.locked; toggled => { root.provider-toggled(idx, self.checked); } }\n')
A('                                    Text { text: provider.detail; font-size: 11px; color: root.theme-muted; wrap: word-wrap; }\n')
A('                                }\n')
A('                            }\n')
A('                            HorizontalBox { spacing: 8px;\n')
A('                                Button { text: "Select all"; enabled: !root.discovery-searching; clicked => { root.select-all-discovery(true); } }\n')
A('                                Button { text: "Clear selection"; enabled: !root.discovery-searching; clicked => { root.select-all-discovery(false); } }\n')
A('                                if root.local-host: Button { text: "Queue selected results (" + root.discovery-selected-count + ")"; enabled: !root.busy && root.discovery-selected-count > 0; clicked => { root.queue-discovery(); } }\n')
A('                            }\n')
A('                            Text { text: root.discovery-status; wrap: word-wrap; color: root.theme-text; }\n')
A('                            for result[index] in root.discovery-results: HorizontalBox { spacing: 8px;\n')
A('                                CheckBox { checked: result.selected; toggled => { root.select-discovery(index, self.checked); } }\n')
A('                                VerticalBox { Text { text: result.title; color: root.theme-text; } Text { text: result.detail; color: root.theme-muted; wrap: word-wrap; } }\n')
A('                            }\n')
A('                            Rectangle { vertical-stretch: 1; }\n')
A('                        }\n')
A('                    }\n')

# ============ ORGANIZATION (workspace 2) ============
A('                    if root.workspace == 2: ScrollView { vertical-stretch: 1; content-y <=> root.manage-organization-scroll-y;\n')
A('                        VerticalBox { spacing: 12px;\n')
A('                            Text { text: "ORGANIZATION"; font-size: 11px; font-weight: 700; color: root.theme-muted; }\n')
A('                            Text { text: "Groups"; font-size: 24px; font-weight: 700; color: root.theme-text; }\n')
A('                            Text { text: "Organize sources in nested groups. Group tags remain inherited by their media."; wrap: word-wrap; color: root.theme-muted; }\n')
A('                            GridLayout { spacing: 12px;\n')
A('                                for card[gindex] in root.group-cards: Rectangle {\n')
A('                                    row: gindex / 2; col: Math.mod(gindex, 2);\n')
A('                                    min-width: 230px;\n')
A('                                    background: root.theme-elevated; border-width: 1px; border-color: root.theme-line; border-radius: 8px;\n')
A('                                    VerticalBox { padding: 12px; spacing: 8px;\n')
A('                                        Text { text: card.name; font-size: 16px; font-weight: 700; color: root.theme-text; }\n')
A('                                        Text { text: card.detail; color: root.theme-muted; font-size: 12px; }\n')
A('                                        HorizontalBox { spacing: 6px;\n')
A('                                            Button { text: "Browse"; clicked => { root.browse-group(gindex); } }\n')
A('                                            if root.can-edit-library: Button { text: "+ Add to group…"; enabled: root.selected-count > 0; clicked => { root.add-to-group(gindex); } }\n')
A('                                        }\n')
A('                                    }\n')
A('                                }\n')
A('                            }\n')
A('                            if root.local-host: HorizontalBox { spacing: 8px;\n')
A('                                LineEdit { placeholder-text: "New group name"; text <=> root.manage-group-name; horizontal-stretch: 1; }\n')
A('                                Button { text: "Create group"; enabled: !root.busy; clicked => { root.create-group(root.manage-group-name); } }\n')
A('                            }\n')
A('                            Text { text: "Sources"; font-size: 18px; font-weight: 700; color: root.theme-text; }\n')
A('                            if root.local-host: HorizontalBox { spacing: 8px;\n')
A('                                LineEdit { placeholder-text: "Source URL"; text <=> root.manage-source-url; horizontal-stretch: 1; }\n')
A('                                Button { text: "Add source"; enabled: !root.busy; clicked => { root.add-sources(root.manage-source-url); } }\n')
A('                            }\n')
A('                            if root.local-host: HorizontalBox { spacing: 8px;\n')
A('                                Button { text: "Import local folder…"; enabled: !root.busy; clicked => { root.import-folder(); } }\n')
A('                                Button { text: "Import source list…"; enabled: !root.busy; clicked => { root.import-sources(); } }\n')
A('                                Button { text: "Export source list"; enabled: !root.busy; clicked => { root.export-sources(); } }\n')
A('                                Button { text: "Resync all sources"; enabled: !root.busy; clicked => { root.resync-all(); } }\n')
A('                                Rectangle { horizontal-stretch: 1; }\n')
A('                            }\n')
A('                            if root.can-edit-library: HorizontalBox { spacing: 8px;\n')
A('                                LineEdit { placeholder-text: "New source name (for Rename)"; text <=> root.manage-source-rename; horizontal-stretch: 1; }\n')
A('                                LineEdit { placeholder-text: "New group name (for Rename)"; text <=> root.manage-group-rename; horizontal-stretch: 1; }\n')
A('                            }\n')
A('                            for entry[index] in root.download-sources: HorizontalBox { spacing: 8px;\n')
A('                                Text { text: entry.label + " — " + entry.phase; overflow: elide; horizontal-stretch: 1; color: root.theme-text; vertical-alignment: center; }\n')
A('                                if root.can-edit-library: Button { text: "Inspect"; clicked => { root.source-manage(index, "inspect"); } }\n')
A('                                if root.can-edit-library: Button { text: "Resync"; clicked => { root.source-manage(index, "resync"); } }\n')
A('                                if root.can-edit-library: Button { text: "Log"; clicked => { root.source-manage(index, "log"); } }\n')
A('                                if root.can-edit-library: Button { text: "Rename"; enabled: root.manage-source-rename != ""; clicked => { root.rename-source(index, root.manage-source-rename); } }\n')
A('                                if root.can-edit-library: Button { text: "Delete"; clicked => { root.source-manage(index, "delete"); } }\n')
A('                            }\n')
A('                            if root.source-detail != "": Text { text: root.source-detail; wrap: word-wrap; color: root.theme-muted; }\n')
A('                            Text { text: "Manage groups"; font-size: 18px; font-weight: 700; color: root.theme-text; }\n')
A('                            for name[gi] in root.groups: HorizontalBox { spacing: 8px;\n')
A('                                Text { text: name; overflow: elide; horizontal-stretch: 1; color: root.theme-text; vertical-alignment: center; }\n')
A('                                if root.can-edit-library: Button { text: "Rename"; enabled: root.manage-group-rename != ""; clicked => { root.rename-group(gi, root.manage-group-rename); } }\n')
A('                                if root.can-edit-library: Button { text: "Delete"; clicked => { root.delete-group(gi); } }\n')
A('                            }\n')
A('                            Rectangle { vertical-stretch: 1; }\n')
A('                        }\n')
A('                    }\n')

# ============ ACTIVITY (workspace 3) ============
A('                    if root.workspace == 3: ScrollView { vertical-stretch: 1; content-y <=> root.manage-activity-scroll-y;\n')
A('                        VerticalBox { spacing: 12px;\n')
A('                            Text { text: "ACTIVITY"; font-size: 11px; font-weight: 700; color: root.theme-muted; }\n')
A('                            Text { text: "Downloads"; font-size: 24px; font-weight: 700; color: root.theme-text; }\n')
A('                            Text { text: "Activity"; font-size: 16px; font-weight: 700; color: root.theme-text; }\n')
A('                            Text { text: "Source-level queue and indexing progress."; wrap: word-wrap; color: root.theme-muted; }\n')
A('                            Text { text: root.download-summary; font-size: 14px; color: root.theme-text; }\n')
A('                            if root.local-host: HorizontalBox { spacing: 8px;\n')
A('                                Button { text: "Pause downloads"; enabled: !root.busy; clicked => { root.downloads(true); } }\n')
A('                                Button { text: "Resume downloads"; enabled: !root.busy; clicked => { root.downloads(false); } }\n')
A('                                Button { text: "Sync all sources"; enabled: !root.busy; clicked => { root.resync-all(); } }\n')
A('                                Rectangle { horizontal-stretch: 1; }\n')
A('                            }\n')
A('                            for entry[index] in root.download-sources: Rectangle {\n')
A('                                background: root.theme-elevated; border-width: 1px; border-color: root.theme-line; border-radius: 8px;\n')
A('                                HorizontalBox { padding: 12px; spacing: 8px;\n')
A('                                    VerticalBox { horizontal-stretch: 1; spacing: 4px;\n')
A('                                        Text { text: entry.label; font-weight: 700; color: root.theme-text; }\n')
A('                                        Text { text: entry.detail; color: root.theme-muted; font-size: 12px; wrap: word-wrap; visible: entry.detail != ""; }\n')
A('                                    }\n')
A('                                    Text { text: entry.phase; color: root.theme-muted; font-size: 12px; vertical-alignment: center; }\n')
A('                                    Button { text: "Pause"; enabled: entry.phase == "active" || entry.phase == "queued" || entry.phase == "indexing" || entry.phase == "retrying"; clicked => { root.source-download(index, true); } }\n')
A('                                    Button { text: "Resume"; enabled: entry.phase == "paused" || entry.phase == "failed" || entry.phase == "completed" || entry.phase == "storage_limit" || entry.phase == "low_disk"; clicked => { root.source-download(index, false); } }\n')
A('                                }\n')
A('                            }\n')
A('                            Rectangle { vertical-stretch: 1; }\n')
A('                            if root.show-diagnostics: VerticalBox { spacing: 8px;\n')
A('                                Text { text: "Diagnostics"; font-size: 16px; font-weight: 700; color: root.theme-text; }\n')
A('                                Text { text: root.manage-status; wrap: word-wrap; color: root.theme-text; }\n')
A('                                Text { text: root.diagnostic-log; wrap: word-wrap; color: root.theme-muted; }\n')
A('                            }\n')
A('                        }\n')
A('                    }\n')

A('                }\n')  # content
A('            }\n')  # sidebar+content HorizontalBox
A('            ' + lines[status_line_idx].strip() + '\n')
A('        }\n')  # main-ui

# ---- menu popup overlay ----
A('        if root.menu-open != "": TouchArea { width: 100%; height: 100%; clicked => { root.menu-open = ""; } }\n')
A('        if root.menu-open != "": Rectangle {\n')
A('            x: 16px; y: 60px; width: 250px; height: root.menu-open == "file" ? 236px : 176px;\n')
A('            background: root.theme-panel; border-width: 1px; border-color: root.theme-line; border-radius: 8px;\n')
A('            VerticalBox { padding: 6px; spacing: 2px;\n')
A('                if root.menu-open == "file": VerticalBox { spacing: 2px;\n')
A('                    Button { text: "Add source…"; clicked => { root.menu-open = ""; root.workspace = 2; } }\n')
A('                    if root.local-host: Button { text: "Import folder…"; clicked => { root.menu-open = ""; root.import-folder(); } }\n')
A('                    if root.local-host: Button { text: "Import source list…"; clicked => { root.menu-open = ""; root.import-sources(); } }\n')
A('                    if root.local-host: Button { text: "Export source list"; clicked => { root.menu-open = ""; root.export-sources(); } }\n')
A('                    Button { text: "Settings…"; clicked => { root.menu-open = ""; root.open-settings(); } }\n')
A('                    Button { text: "Quit"; clicked => { root.menu-open = ""; root.quit-window(); } }\n')
A('                }\n')
A('                if root.menu-open == "tools": VerticalBox { spacing: 2px;\n')
A('                    if root.local-host: Button { text: "Resync all sources"; clicked => { root.menu-open = ""; root.resync-all(); } }\n')
A('                    Button { text: "Refresh diagnostics"; clicked => { root.menu-open = ""; root.refresh-manage(); } }\n')
A('                    Button { text: "View diagnostic log"; clicked => { root.menu-open = ""; root.show-diagnostics = true; root.workspace = 3; root.refresh-diagnostic-log(); } }\n')
A('                    if root.local-host: Button { text: "Create backup"; clicked => { root.menu-open = ""; root.recovery("Create backup", "", ""); } }\n')
A('                }\n')
A('                Rectangle { vertical-stretch: 1; }\n')
A('            }\n')
A('        }\n')

# ---- stage overlay: player/feed/review/goon/slideshow/wall/cockhero ----
A('        if root.stage-open: Rectangle {\n')
A('            width: 100%; height: 100%; background: root.theme-background;\n')
A('            VerticalBox { padding: 16px; spacing: 12px;\n')
A('                HorizontalBox { spacing: 6px;\n')
A('                    for label[index] in ["Player", "Feed", "Review", "GOON", "Slideshow", "Portrait Wall", "Cock Hero"]: Button {\n')
A('                        text: label; primary: root.stage-mode == index;\n')
A('                        clicked => { root.stage-mode = index; }\n')
A('                    }\n')
A('                    Rectangle { horizontal-stretch: 1; }\n')
A('                    Button { text: "Close"; clicked => { root.stage-open = false; } }\n')
A('                }\n')
for n, mode in [(1, 0), (2, 1), (3, 2), (4, 3), (5, 4), (6, 5), (7, 6)]:
    text, _ = extract_block(ws[n])
    if n != 1:
        # Session-mode pages are VerticalBoxes stretched to the Stage height;
        # absorb vertical excess here so it is not spread over the controls.
        stripped = text.rstrip()
        assert stripped.endswith("}"), n
        text = stripped[:-1] + "            Rectangle { vertical-stretch: 1; }\n        }\n"
    if n == 2:
        # Feed button row: prevent Slint from spreading vertical excess
        # over the buttons.
        text = text.replace(
            '            HorizontalBox {\n                Button { text: "Start / restart feed";',
            '            HorizontalBox { vertical-stretch: 0;\n                Button { text: "Start / restart feed";',
            1)
    if n == 1:
        # Player queue panel: keep its buttons compact when the queue is
        # empty (Slint spreads excess over unstretched box children).
        text = text.replace(
            'Button { text: root.queue-repeat ? "Repeat: on" : "Repeat: off"; clicked => { root.queue-set-repeat(!root.queue-repeat); } }\n                    }',
            'Button { text: root.queue-repeat ? "Repeat: on" : "Repeat: off"; clicked => { root.queue-set-repeat(!root.queue-repeat); } }\n                        Rectangle { horizontal-stretch: 1; }\n                    }',
            1)
        text = text.replace(
            'Button { text: "Remove"; clicked => { root.remove-queued(index); } }\n                    }\n                }',
            'Button { text: "Remove"; clicked => { root.remove-queued(index); } }\n                    }\n                    Rectangle { vertical-stretch: 1; }\n                }',
            1)
    first, rest = text.split("\n", 1)
    # first line looks like: `        if root.workspace == N: HorizontalBox {`
    m = re.match(r"^(\s*)if root\.workspace == \d: (\S+) \{$", first)
    if not m:
        raise RuntimeError(f"unexpected section head: {first!r}")
    indent, kind = m.group(1), m.group(2)
    A(f'{indent}if root.stage-open && root.stage-mode == {mode}: {kind} {{ vertical-stretch: 1;\n')
    A(rest)
A('            }\n')
A('        }\n')

# ---- settings modal (verbatim, repositioned) ----
A('        ' + '\n'.join('' for _ in range(0)))  # noop
settings_text, _ = extract_block(settings_if)
# drop the two comment lines preceding it (already skipped by starting at settings_if)
settings_text = settings_text.replace(
    "width: parent.width - 64px; height: parent.height - 64px;",
    "width: root-rect.width - 64px; height: root-rect.height - 64px;")
A('        ' + settings_text.replace("\n", "\n        ").rstrip() + "\n")

# ---- setup overlay (verbatim) ----
setup_text, _ = extract_block(setup_if)
A('        ' + setup_text.replace("\n", "\n        ").rstrip() + "\n")

A('    }\n')  # root-rect
A('}\n')

with open(DST, "w") as f:
    f.write("".join(out))
print("written", DST)
