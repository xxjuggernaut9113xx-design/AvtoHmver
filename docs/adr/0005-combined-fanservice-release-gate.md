---
status: accepted
---

# Use one combined release gate with newest-first game support

The user chose one combined release checklist for AvtoHmver and Fanservice on 2026-11-05. Required acceptance includes the Server, Windows mod, combined Host installer, browser/PWA and Android deliverables alongside the existing included parity areas. Dated component results contribute evidence to this gate, and completion requires acceptance of the combined scope.

Game integration prioritizes the newest available usable version. An older version is a fallback when the newer version cannot be used. Investigate failures on the newer version before falling back. Record the blocking condition, the tested build identity and the path to resume work on the newer version so current support follows the user's version priority.

The combined release plan uses Web app, Android app and Windows game mod as its user-facing edition names. Gameplay is required in the Windows game mod, Web app and Android app. The Web app and Android app implement gameplay for phones. The user requested REA-based recovery of original gameplay and explicit direction on features specific to the mobile form factor. The combined acceptance gates are maintained in docs/parity/STATUS.md.
