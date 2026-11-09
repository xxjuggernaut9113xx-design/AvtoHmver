# P-HAR ticket #13 runtime evidence

Measured on 2026-11-08 with the official RGB TimeSformer checkpoint
(`94adf9900cd36360795709d920b44404f29bad3e`, SHA-256
`184163c9c527113432dc6bfb639e1e604614186d243a6006016772455024378f`,
970,440,477 bytes). The CPU and CUDA acceptance records both passed on
Python 3.10.11. The worker hashes were CPU
`9c46384af2bbcaea5eb87609e0291a068203f23cae028c29f6b96b1a0a380d17`
and CUDA `1e1bb10af3c24aeb5fdd951b8b0ebd7c34d74ed799fd026aeef288f1c0722051`.

Both backends produced matching sample labels and nearly identical scores on
the two supplied videos. On the benchmark clip, the first two windows were
`handjob` (0.5843) and `fondling` (0.6157). On the neutral-motion clip, the
two windows were `anal` (0.7799 and 0.6101), a clear false positive in this
small smoke sample. CPU processing took 135.40 seconds for the benchmark and
82.69 seconds for the neutral clip; CUDA took 7.89 and 5.48 seconds,
respectively. CUDA was available on an NVIDIA GeForce GTX 1650 SUPER.

These runs establish that the pinned model loads and performs inference on CPU
and CUDA. They are runtime smoke evidence only: `accuracy_evaluated` was
`false`, and the supplied clips do not satisfy ticket #13's labeled-clip
acceptance requirement. No accuracy or release-completion claim follows from
these results. Source records: `cpu-acceptance.json` and `cuda-acceptance.json`
from the ticket #13 acceptance run; clip paths are intentionally omitted.
