"""Opt-in real-video RGB acceptance probe; no readiness marker is fabricated.

Run with the private managed Python after arranging environment/upstream,
environment/checkpoints/timeSformer.pth and its pinned dependencies. Videos and
checkpoint remain outside the repository. A neutral result proves execution,
not recognition accuracy or coverage of the 17 classes.
"""
import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import sys
import time
import traceback


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--video", type=Path, action="append", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda:0"), default="cpu")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    worker = Path(__file__).resolve().parents[1] / "workers/action_worker.py"
    spec = importlib.util.spec_from_file_location("phar_rgb_worker", worker)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    checkpoint = args.environment / "checkpoints/timeSformer.pth"
    report = dict(device=args.device, python=sys.version, executable=sys.executable,
                  worker_sha256=sha256(worker), videos=[], accuracy_evaluated=False,
                  checkpoint_bytes=checkpoint.stat().st_size,
                  checkpoint_sha256=sha256(checkpoint))
    assert report["checkpoint_bytes"] == 970440477
    assert report["checkpoint_sha256"] == "184163c9c527113432dc6bfb639e1e604614186d243a6006016772455024378f"
    report["packages"] = {name: importlib.metadata.version(name) for name in (
        "torch", "torchvision", "numpy", "mmcv", "opencv-python", "einops")}
    try:
        start = time.perf_counter()
        with contextlib.redirect_stdout(sys.stderr):
            model = module.RGBModel(args.environment.resolve(), args.device)
        report["load_secs"] = time.perf_counter() - start
        report["cuda_available"] = model.torch.cuda.is_available()
        if args.device != "cpu":
            report["gpu"] = model.torch.cuda.get_device_name(0)
            model.torch.cuda.reset_peak_memory_stats()
        for video in args.video:
            start = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                result = model.predict(video.resolve(), [(0, 14)])
            report["videos"].append(dict(path=str(video.resolve()), sha256=sha256(video),
                                          elapsed_secs=time.perf_counter() - start,
                                          result=result))
        if args.device != "cpu":
            report["peak_allocated_bytes"] = model.torch.cuda.max_memory_allocated()
            report["peak_reserved_bytes"] = model.torch.cuda.max_memory_reserved()
        report["passed"] = True
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        traceback.print_exc()
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(report, separators=(",", ":"), allow_nan=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
