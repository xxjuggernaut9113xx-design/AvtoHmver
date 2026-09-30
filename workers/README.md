# Inference worker protocol

Both optional Python workers speak UTF-8 JSON Lines on stdin/stdout. Each
message has `protocol_version: 1`; the [schema](protocol-v1.schema.json)
describes the wire shapes. Rust refuses a missing or different version at
startup and for each response. Worker stderr is diagnostic only.

On startup a worker emits a `ready` message. NudeNet accepts a request with
an integer `id` and one to twelve `paths`, returning ordered `results` for
those paths. P-HAR accepts an `id`, one `path`, and up to 64 `(start, end)`
windows, returning one `result`. A failed request returns the same `id` and
an `error`; malformed input may use a null ID. The worker stays alive after
a request error.

The optional models and runtime markers are separate from this wire version.
If a future wire change is incompatible, increment the version in Rust, both
workers, this schema, and the contract tests in one change. The Host handshake
advertises `worker_protocol_version` for diagnostics; remote clients never
call the inference workers directly.
