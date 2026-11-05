---
status: accepted
---

# Preserve Viewer+ data across the origin change

The Android Viewer+ update changes the local web origin to enable remote media. Before this update ships, it must migrate existing on-device profiles, settings, files, and snapshots with verified completeness. An interrupted or failed migration keeps the old data accessible in compatibility mode and offers Retry; the app must not present a partial copy as complete. This protects media and progress that cannot be recovered from the Host or a pack export.
