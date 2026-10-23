# Discover interfaces and limits

Discover loads immutable search snapshots in batches of 40. Appending a batch preserves the current selection, existing rows, and scroll position. Snapshots expire after ten minutes and belong to the active library. Expired searches report an error and can be restarted. Up to 32 snapshots are retained.

Local search includes up to 2,000 matching sources and 2,000 matching creators. File counts and byte totals use catalog data; incomplete size data is labeled Unknown. Cumulative totals describe loaded results, not the entire provider index. Albums and creators can overlap, so these totals are sums of results rather than unique files across the library.

Remote results use bounded provider responses. Balbums currently retrieves its first 50-result page; Kemono and Coomer use their existing bounded offset search. Erome retrieves up to three 36-album pages. Redgifs retrieves the first 100-result page. Discover continuously appends the available snapshot; it does not yet continue an unlimited remote index. This remaining limitation must not be described as full provider pagination parity.

Erome's public `/search?q=...&page=...` interface and Redgifs' temporary bearer-token `/v2/auth/temporary` plus `/v2/gifs/search?search_text=...` interface follow the maintained [Erome extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/erome.py) and [Redgifs extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/redgifs.py). Browser challenges, authentication changes, rate limits, unavailable hosts, and unsupported response shapes remain visible provider errors. Paste an Erome album URL or a Redgifs watch URL into Discover to use the direct-URL path when search is unavailable. No challenge bypass or user-token persistence is performed.

DeviantArt text search remains unavailable because this build has no registered OAuth application or authorization flow. Its [authentication documentation](https://deviantart.readme.io/docs/authentication) requires application registration. Paste a DeviantArt gallery or artwork URL instead.

Other registry entries without the `search` capability are explicitly direct-URL-only. Their registry availability is `direct_url_only`, and no text-search interface is fabricated. Open a provider in the browser, then paste its gallery, post, or creator page into Discover or Add source. Gallery-dl support still depends on the installed extractor version and provider access requirements. Unknown counts and sizes remain Unknown rather than guessed from covers or previews.

Linux desktop acceptance checks are excluded from the 0.4.0 request by the user's 2026-10-01 instruction. Windows, Viewer access, package compatibility, and the remaining acceptance gates still apply.
