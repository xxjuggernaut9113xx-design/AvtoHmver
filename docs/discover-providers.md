# Discover interfaces and limits

Discover loads immutable search snapshots in batches of 40. Appending a batch preserves the current selection, existing rows, and scroll position. Snapshots expire after ten minutes and belong to the active library. Expired searches report an error and can be restarted. Up to 32 snapshots are retained.

Local search includes up to 2,000 matching sources and 2,000 matching creators. File counts and byte totals use catalog data; incomplete size data is labeled Unknown. Cumulative totals describe loaded results, not the entire provider index. Albums and creators can overlap, so these totals are sums of results rather than unique files across the library.

Continuous Discover now requests subsequent pages for all five implemented
remote text-search providers: Erome uses 36-album pages, Balbums follows its
actual next-page links and 20-result setting, Kemono/Coomer advance their
50-post offsets, and Redgifs follows its reported page count. The legacy
non-paged API retains its bounded initial responses. Kemono/Coomer pin the
successful host for a search so later pages cannot silently switch indexes.
Their calls are paced, and HTTP 429 preserves the page and its Retry-After
cooldown (60 seconds when the provider supplies no usable delay).

Redgifs now continues through its reported provider pages, requesting the next
100-result page when scrolling exhausts the cached rows. Results append without
reordering earlier rows; subsequent batches retain provider order. The initial
batch uses the selected sort. Duplicate watch URLs are suppressed across pages,
replayed cursors return cached rows, and failed requests retain their page for
retry. An empty or fully repeated page ends continuation. The ten-minute search
lifetime still applies. Tokens remain temporary and are never persisted.
This follows the maintained extractor's `page`, `count`, and `pages` contract;
The same cached-cursor, deduplication and terminal-page rules apply to the
other searchable providers. Multiple providers take turns; a failed provider
keeps its page for retry without preventing healthy providers from advancing.
Provider errors remain visible until that provider recovers.

Erome's public `/search?q=...&page=...` interface and Redgifs' temporary bearer-token `/v2/auth/temporary` plus `/v2/gifs/search?search_text=...` interface follow the maintained [Erome extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/erome.py) and [Redgifs extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/redgifs.py). Browser challenges, authentication changes, rate limits, unavailable hosts, and unsupported response shapes remain visible provider errors. Paste an Erome album URL or a Redgifs watch URL into Discover to use the direct-URL path when search is unavailable. No challenge bypass or user-token persistence is performed.

DeviantArt text search remains unavailable because this build has no registered OAuth application or authorization flow. Its [authentication documentation](https://deviantart.readme.io/docs/authentication) requires application registration. Paste a DeviantArt gallery or artwork URL instead.

Other registry entries without the `search` capability are explicitly direct-URL-only. Their registry availability is `direct_url_only`, and no text-search interface is fabricated. Open a provider in the browser, then paste its gallery, post, or creator page into Discover or Add source. Gallery-dl support still depends on the installed extractor version and provider access requirements. Unknown counts and sizes remain Unknown rather than guessed from covers or previews.

Linux desktop acceptance checks are excluded from the 0.4.0 request by the user's 2026-10-01 instruction. Windows, Viewer access, package compatibility, and the remaining acceptance gates still apply.
