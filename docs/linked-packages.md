# Same-PC linked .chpack staging

On the native Host, open Organization and choose **Stage linked .chpack**. In a browser on the library computer, choose **Stage linked .chpack** in the sidebar. The local browser workflow works with Host and Server editions. It stages downloaded images, videos, GIFs and physical clips in the active library. Virtual ranges and unavailable or retention-deleted originals are excluded.

The library owner creates a managed directory beneath `LIBRARY/.avtohmver-linked-packages/`, hard-links each source into its `media` directory, and builds an ordinary portable `.chpack` ZIP with the existing `0.02a` manifest and rating-to-speed tags. Staging links do not duplicate original media bytes. The ZIP itself necessarily stores media bytes; ZIP links are not substituted for portable media. Sources and staging must share a filesystem volume; cross-volume linking reports an error rather than silently copying originals. No administrator privilege or Windows symlink privilege is required for ordinary file hard links.

The owning Host or Server validates original paths, file identities, sizes,
and modification times before and after archive creation. It checks durable
staging records every two seconds while running, with maintenance admission
controlling access. If a source moves, disappears, is replaced, or changes,
the owner removes that generated staging directory and its managed `.chpack`.
It never deletes the original source or a moved source. Restarting resumes
validation of existing managed packages. During maintenance or while the
owner is stopped, invalidation waits until validation resumes.

The generated path appears in the native status message. The staging row shows progress and has **Cancel staging**. Cancellation interrupts archive reads in bounded chunks and removes partial staging. A copy exported elsewhere is an independent portable package and will not self-destruct; AvtoHmver only removes packages inside its own managed staging directory. Portable export retains its independent behavior and compatibility identifiers. Unsafe filename characters in tags, including the position namespace colon, become hyphens in package filenames; valid existing tag filenames keep their established alphabetical ordering.

The browser shows progress, cancellation, and the resulting local path. Closing
the dialog leaves the background job running; reopening reconnects to its
status. Only one browser staging job runs at a time. Native Viewers and remote
HTTP callers cannot start, cancel, or inspect local staging paths. Portable
export remains available for remote devices.

A build lock protects active staging from the monitor. Abandoned owned partial
containers are reclaimed after a 60-second grace period once their build lock
has been released. Corrupt owned records are invalidated instead of presented
as usable packages. This cleanup never follows a source path for deletion.

Automated checks cover manifest/media round trips, source moves, changes and replacements, preservation of originals and independent portable copies, missing inputs, cancellation before and during staging, interrupted builds, owner/Viewer/remote admission, and browser close/reopen and late replies. External Cock Hero importer acceptance remains an independent release check.
