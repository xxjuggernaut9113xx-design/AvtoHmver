# Ticket 30 native image integration

The Server resolver returns a deduplicated union of explicit media IDs and live rules. It bounds each request to 500 explicit IDs, 32 rules and 10,000 results, checks underlying media paths, and returns absent explicit members in `missing_ids`. The route tests cover overlapping membership, changed library state on a later resolution, and empty results. This verifies Server resolution independently of original-game session admission.

The exact `v0051-hotfix-public-a8f46896` runtime has displayed a prepared neutral PNG through original gameplay using the native `.chpack` archive path. The current v0.05 adapter has no native session-admission operation that resolves the live Server selection and binds its media to that game’s pools. The original pack manager reads enabled archive/cache manifests. Its v0.05 media-entry structure also differs from v0.04, so the older structure cannot be reused for direct assignment.

Native acceptance still needs a game-owned pool handoff, empty and missing-member admission feedback, and independent checks that a live library edit changes the next session while the active session retains its original media identities. The existing locally delivered image does not verify these behaviors.
