---
status: accepted
---

# Start with official RGB P-HAR and a tested CPU fallback

The first managed P-HAR runtime for 0.4.0 will use the official RGB video model, which covers the required position labels without pose and audio checkpoints. It may run on a compatible GPU or on CPU when the GPU path is unavailable, with measured performance and a real inference probe before acceptance. Models are fetched on demand from the official release and pinned by exact bytes; neither model files nor acceptance media are bundled into AvtoHmver.
