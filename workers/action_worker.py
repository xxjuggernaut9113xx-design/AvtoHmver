#!/usr/bin/env python3
"""Managed official P-HAR RGB TimeSformer, using its pinned MMAction2 code.

Model construction, frame sampling, three-crop preprocessing and probability
averaging come from the official configuration. OpenCV replaces Decord, as
supported by the pinned upstream inference API. No pose/audio models are used.
"""
import argparse
import contextlib
import copy
import hashlib
import json
import math
import sys
import time
from pathlib import Path

UPSTREAM_REVISION = "94adf9900cd36360795709d920b44404f29bad3e"
MMACTION_REVISION = "255bbc08634c21e6400af7b9d1a470b52285ebcd"
RUNTIME_FORMAT = "curator-phar-runtime-v2"
PROTOCOL_VERSION = 1
LABELS = ("kissing", "fondling", "handjob", "fingering", "titjob", "blowjob",
          "cunnilingus", "deepthroat", "doggy", "the-snake", "anal", "missionary",
          "cowgirl", "scoop-up", "cumshot", "facial-cumshot", "69")
CONFIG = "configs/timesformer/timesformer_divST_16x12x1_15e_kinetics400_rgb.py"
CHECKPOINT_BYTES = 970440477
CHECKPOINT_SHA256 = "184163c9c527113432dc6bfb639e1e604614186d243a6006016772455024378f"


def emit(value):
    value["protocol_version"] = PROTOCOL_VERSION
    print(json.dumps(value, separators=(",", ":"), allow_nan=False), flush=True)


def load_runtime(environment):
    try:
        runtime = json.loads((environment / "runtime.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"Run Repair: managed P-HAR runtime marker is unavailable ({error})") from error
    if runtime.get("format") != RUNTIME_FORMAT:
        raise RuntimeError("Run Repair: P-HAR RGB runtime marker is missing or obsolete")
    if runtime.get("upstream_revision") != UPSTREAM_REVISION or runtime.get("mmaction_revision") != MMACTION_REVISION:
        raise RuntimeError("P-HAR source revisions do not match the official RGB runtime")
    if not runtime.get("checkpoints_verified") or not runtime.get("inference_probe_passed"):
        raise RuntimeError("P-HAR has not passed checkpoint verification and real inference")
    if runtime.get("artifact_hashes", {}).get("p-har-timesformer") != CHECKPOINT_SHA256:
        raise RuntimeError("Run Repair: RGB checkpoint identity is missing from the runtime")
    if runtime.get("backend") not in {"cpu", "cuda", "rocm"}:
        raise RuntimeError("P-HAR runtime backend is unavailable")
    expected_device = "cpu" if runtime["backend"] == "cpu" else "cuda:0"
    if runtime.get("device") != expected_device:
        raise RuntimeError("P-HAR backend and device do not agree")
    python = Path(runtime.get("managed_python", "")).resolve()
    if not python.is_relative_to(environment) or python != Path(sys.executable).resolve():
        raise RuntimeError("P-HAR must run in its private managed interpreter")
    return runtime


def verify_checkpoint(environment):
    checkpoint = environment / "checkpoints/timeSformer.pth"
    if checkpoint.stat().st_size != CHECKPOINT_BYTES:
        raise RuntimeError("Run Repair: RGB checkpoint size differs from the pinned asset")
    digest = hashlib.sha256()
    with checkpoint.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != CHECKPOINT_SHA256:
        raise RuntimeError("Run Repair: RGB checkpoint SHA-256 differs from the pinned asset")


def score_for_label(prediction, label):
    """Read legacy demo confidence safely (kept for imported evidence)."""
    best = 0.0
    if isinstance(prediction, dict):
        for raw_score, raw_label in prediction.items():
            if str(raw_label).strip().lower() != label.lower():
                continue
            try:
                score = float(raw_score)
            except (TypeError, ValueError, OverflowError):
                continue
            if math.isfinite(score):
                best = max(best, score)
    return max(0.0, min(1.0, best))


def temporal_segments(duration, requested_windows):
    segments = []
    for index in range(math.ceil(duration / 7.0)):
        start, end = index * 7.0, min((index + 1) * 7.0, duration)
        if any(start < wanted[1] and wanted[0] < end for wanted in requested_windows):
            segments.append((start, end))
            if len(segments) > 64:
                raise ValueError("request overlaps more than 64 model windows; submit smaller batches")
    if not segments:
        raise ValueError("No requested windows overlap readable video")
    return segments


class RGBModel:
    def __init__(self, environment, device="cpu"):
        self.environment = environment
        upstream = environment / "upstream"
        sys.path.insert(0, str(upstream / "mmaction2"))
        import cv2
        import mmcv
        import torch
        from mmcv.parallel import collate, scatter
        from mmcv.runner import load_checkpoint
        from mmaction.apis import init_recognizer
        from mmaction.datasets.pipelines import Compose
        self.cv2, self.torch = cv2, torch
        self.collate, self.scatter, self.Compose = collate, scatter, Compose
        self.device = device
        torch.set_num_threads(6)
        cv2.setNumThreads(1)
        if device != "cpu" and not torch.cuda.is_available():
            raise RuntimeError("CUDA/ROCm is unavailable in the managed runtime")
        labels = tuple((upstream / "resources/annotations/annotations.txt").read_text().splitlines())
        if labels != LABELS:
            raise RuntimeError("Official 17-class annotation vocabulary differs")
        config = mmcv.Config.fromfile(str(upstream / CONFIG))
        # Evaluate the same three spatial crops sequentially to bound memory.
        config.model.test_cfg.max_testing_views = 1
        self.model = init_recognizer(config, checkpoint=None, device=device)
        load_checkpoint(self.model, str(environment / "checkpoints/timeSformer.pth"), map_location="cpu", strict=True)
        self.pipeline = copy.deepcopy(config.data.test.pipeline)
        self.pipeline[0] = dict(type="OpenCVInit")
        self.pipeline[2] = dict(type="OpenCVDecode")

    def predict(self, path, requested_windows):
        capture = self.cv2.VideoCapture(str(path))
        try:
            fps = capture.get(self.cv2.CAP_PROP_FPS)
            frame_count = int(capture.get(self.cv2.CAP_PROP_FRAME_COUNT))
        finally:
            capture.release()
        if not math.isfinite(fps) or fps <= 0 or frame_count <= 0:
            raise RuntimeError("Video has no readable frames or frame rate")
        duration = frame_count / fps
        windows = []
        for start, end in temporal_segments(duration, requested_windows):
            before = time.perf_counter()
            data = dict(filename=str(path), label=-1, start_index=0, modality="RGB")
            data = self.Compose(self.pipeline[:1])(data)
            offset = int(round(start * fps))
            data["total_frames"] = max(1, min(int(round(end * fps)), frame_count) - offset)
            data = self.Compose(self.pipeline[1:2])(data)
            data["frame_inds"] += offset
            data = self.Compose(self.pipeline[2:])(data)
            data = self.collate([data], samples_per_gpu=1)
            if self.device != "cpu":
                data = self.scatter(data, [next(self.model.parameters()).device])[0]
            with self.torch.inference_mode():
                scores = self.model(return_loss=False, **data)[0]
            values = [float(score) for score in scores]
            if len(values) != len(LABELS) or not all(math.isfinite(score) and 0 <= score <= 1 for score in values):
                raise RuntimeError("P-HAR produced invalid 17-class probabilities")
            if not math.isclose(sum(values), 1.0, abs_tol=0.001):
                raise RuntimeError("P-HAR class probabilities do not sum to one")
            winner = max(range(len(values)), key=values.__getitem__)
            windows.append(dict(start_secs=start, end_secs=end, label=LABELS[winner],
                                score=values[winner], scores=dict(zip(LABELS, values)),
                                elapsed_secs=time.perf_counter() - before))
        return dict(model="P-HAR official RGB TimeSformer", version=UPSTREAM_REVISION,
                    backend=self.device, windows=windows)


def valid_windows(request):
    requested = request.get("windows")
    if not isinstance(requested, list) or not 1 <= len(requested) <= 64:
        raise ValueError("one to 64 temporal windows are required")
    windows = []
    for window in requested:
        if not isinstance(window, (list, tuple)) or len(window) != 2:
            raise ValueError("invalid temporal window")
        start, end = map(float, window)
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
            raise ValueError("invalid temporal window")
        windows.append((start, end))
    return windows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--video", help="real video for a one-shot inference self-test")
    parser.add_argument("--device", choices=("cpu", "cuda:0"), default="cpu",
                        help="candidate device for --probe only")
    args = parser.parse_args()
    environment = Path(args.environment).resolve()
    try:
        # A candidate is tested before readiness exists. Only the installer may
        # publish runtime.json after this one-shot probe returns valid output.
        if args.probe:
            if not args.video:
                raise RuntimeError("Inference self-test requires a real video")
            verify_checkpoint(environment)
            device = args.device
        else:
            device = load_runtime(environment)["device"]
        with contextlib.redirect_stdout(sys.stderr):
            before = time.perf_counter()
            model = RGBModel(environment, device)
            load_secs = time.perf_counter() - before
            if args.probe:
                result = model.predict(Path(args.video), [(0, 7)])
        if args.probe:
            emit(dict(ready=True, result=result, load_secs=load_secs,
                      mmaction_revision=MMACTION_REVISION))
            return 0
    except Exception as error:
        emit(dict(ready=False, error=str(error)))
        return 1
    emit(dict(ready=True, model="P-HAR official RGB TimeSformer", version=UPSTREAM_REVISION))
    for raw_line in sys.stdin:
        request_id = None
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            if request.get("protocol_version") != PROTOCOL_VERSION:
                raise ValueError("unsupported worker protocol version")
            path = Path(request["path"])
            if not path.is_file():
                raise ValueError("video path is unavailable")
            windows = valid_windows(request)
            with contextlib.redirect_stdout(sys.stderr):
                result = model.predict(path, windows)
            emit(dict(id=request_id, result=result))
        except Exception as error:
            emit(dict(id=request_id, error=str(error)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
