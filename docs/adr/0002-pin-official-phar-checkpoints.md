---
status: accepted
---

# Pin official P-HAR checkpoints from measured hashes

P-HAR's official release provides model files without published checksums. AvtoHmver may record hashes measured from those exact official release assets, together with their source identity, and accept later downloads only when the bytes match. This permits a repeatable offline managed install while avoiding arbitrary model URLs; a successful native inference check with the required position labels remains necessary before release acceptance.
