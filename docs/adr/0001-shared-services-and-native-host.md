# ADR 0001: Shared services for Curator interfaces

Status: accepted for new work (2026-09-29)

## Context

Curator has a native Windows Host, a browser interface served by the headless
Server, and a limited remote Viewer. They share one Rust core. Existing HTTP
routes are used by the browser and phones, while the Host increasingly calls
typed services directly. Replacing working routes solely to unify adapters
would add risk without improving the current workflows.

## Decision

- Keep the native Host and the Server browser interface. The latter remains the
  stable path for headless Server and phone access.
- Put new stateful behavior and permission checks in `services::*` first. The
  native UI and HTTP handlers translate input and output at their boundaries.
- Preserve published HTTP paths, methods, and payloads when moving an
  operation into a service. Existing route-adapted operations may remain until
  an actual reliability or parity need requires extraction.
- Do not add browser-only desktop features. Browser work is appropriate for
  headless Server and phone clients, as well as compatibility fixes.
- Use [the permission matrix](../permissions.md) as the sole role authority.
  The [parity status](../parity/STATUS.md) records which features already have
  a service operation.

## Consequences

New work needs service-level tests and adapter contract tests where a route is
exposed. The Host can call services without an internal HTTP round trip. Both
interfaces can progress incrementally without a repository-wide migration.

Python inference workers remain external processes for now. Their line-based
protocol is documented separately; moving inference in-process is not a
prerequisite for the Windows Host.
