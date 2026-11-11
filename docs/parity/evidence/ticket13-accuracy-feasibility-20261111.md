# #13 accuracy-evaluation feasibility — 2026-11-11

Read-only assessment in `~/workspace/AvtoHmver` on branch
`spec/avtohmver-open-tickets` at HEAD `4eaaf44`. No player code changed,
no checkpoint downloaded, no evaluation run. Ticket #13's acceptance
requires native inference producing all required position labels on
**locally held labeled and neutral clips**, with CPU fallback measured
honestly. Prior state (see `phar-ticket13-runtime.md` and the survey
`docs/fanservice/evidence/ticket-survey-57-59-60-25-13-20261111.md`):
real CPU/CUDA inference exists, but `accuracy_evaluated=false`, and the
only neutral-clip sample was a false positive (`anal` 0.7799 / 0.6101).

## Verdict: NOT achievable in this VM

An accuracy evaluation cannot be run here. The blocker is not the
checkpoint and not disk space — it is the absence of labeled clips and
of a runnable inference stack on Linux/Python 3.12.

## (a) Checkpoint — available, public, not paywalled

- Source: `https://github.com/rlleshi/phar/releases/download/v1.0.0/timeSformer.pth`
  (release v1.0.0, asset ID 68193860, repo `rlleshi/phar`, Apache-2.0).
- Verified 2026-11-11 by HTTP HEAD (no download): `200 OK`,
  `Content-Length: 970440477`, exactly matching the pinned
  `CHECKPOINT_BYTES = 970440477` in `workers/action_worker.py:26` and
  the pinned SHA-256 `184163c9…4378f` recorded in
  `docs/parity/evidence/phar-rgb-asset.md`.
- Disk here is not a constraint (119 GB free). The checkpoint was not
  downloaded because downloading it alone enables nothing without (b)
  and (c) below.

## (b) Labeled clips — none available, none constructible here

- No labeled or neutral clips exist in this VM. The only video in the
  repo is `tests/fixtures/fanservice/resume.mp4` (4 s, 2,607 bytes, a
  resume fixture) — unlabeled and not a position clip.
- The two clips from the 2026-11-08 acceptance runs are held on another
  machine (E:); their paths are intentionally omitted from the evidence
  records, and no ground-truth label was ever recorded for either — the
  benchmark clip has only predicted labels (`handjob` 0.5843,
  `fondling` 0.6157). The neutral clip is a known false-positive sample,
  but one unlabeled sample is not an evaluation set.
- The upstream P-HAR dataset (~600 videos, 2,674 min; ~17.6K train /
  ~4.9K val RGB clips, per the `rlleshi/phar` README) is **not
  publicly downloadable**: the repo contains only label-name lists
  (`resources/annotations/annotations.txt`, the 17 class names) and
  annotation-distribution plots/JSONs — no dataset download link in
  the README or the repo tree (checked via the GitHub contents API at
  the pinned revision `94adf9900cd36360795709d920b44404f29bad3e`).
- Constructing a labeled set here would require sourcing adult videos
  and hand-labeling 17 positions plus neutral clips. That material and
  that labeling work do not exist in this VM.

## (c) CPU torch runtime — pinned stack cannot run here

- This VM: Python 3.12.3 only (no 3.10), `torch` not installed,
  `numpy`/`cv2` not installed, 4 CPUs, 7 GB RAM, no GPU.
- The pinned stack (`workers/phar_runtime.py`) is Windows-only by
  construction: `torch-1.13.1+cpu-cp310-cp310-win_amd64`,
  `torchvision-0.14.1+cpu`, `mmcv==1.5.0`, pinned MMAction2 revision
  `255bbc08634c21e6400af7b9d1a470b52285ebcd`, embedded CPython 3.10.
  None of it runs on Linux/Python 3.12.
- A modern Linux CPU torch exists (PyPI: `torch-2.5.1-cp312-cp312-
  manylinux1_x86_64.whl`, 906,389,343 bytes; pip works), but using it
  would require porting the MMAction2 0.x TimeSformer config/checkpoint
  loading to a modern torch/mmaction2 stack — unvalidated work, and it
  would still be blocked on (b). CPU speed is not the binding
  constraint: the prior Windows CPU run took 135.40 s / 82.69 s per
  clip, so a small labeled set would be slow but tractable once (b)
  and (c) exist.

## (d) No evaluation run — nothing to measure

No precision/recall or false-positive rate can be reported: there are
no labeled clips to score and no runnable model to score them with.
No smoke test was run or presented as an evaluation.

## What would unblock it

1. **Labeled clip set** (the core blocker): locally held clips with
   ground-truth labels covering the 17 positions, plus neutral clips —
   supplied from Kevin's local holdings or newly sourced and
   hand-labeled. The upstream dataset cannot be downloaded.
2. **Checkpoint**: download the public 970,440,477-byte release asset
   and verify size + SHA-256 against the pin (reachable from here).
3. **Runtime**: a Windows host with the pinned embedded CPython 3.10,
   torch 1.13.1 CPU/CUDA, mmcv 1.5.0 and pinned MMAction2 — or a
   validated Linux port of the inference path to modern torch.
4. Then run `tests/phar_rgb_acceptance.py` over the labeled set and
   record per-label results with `accuracy_evaluated=true`, including
   the false-positive behaviour on neutral clips.

## Note on upstream-reported accuracy

The `rlleshi/phar` README publishes RGB TimeSformer top-1 0.5669 /
top-2 0.6834 on the author's own validation set. That is the author's
reported metric for their model, **not** an evaluation of this
checkout's runtime, and it must not be cited as #13 evidence.

## Conclusion

#13's acceptance criteria are **not met**: no labeled accuracy
evaluation exists, and none can be produced in this VM. The ticket
stays open. Do not close it on inference alone.
