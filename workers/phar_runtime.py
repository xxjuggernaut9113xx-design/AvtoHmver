"""Private Windows RGB runtime provisioner. Invokes the existing action worker.

The host supplies a pinned embedded interpreter, owns cancellation of this
process tree, and holds the setup lock. Success is published only after the
worker loads the exact checkpoint and performs real video inference.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

UPSTREAM = "94adf9900cd36360795709d920b44404f29bad3e"
MMACTION = "255bbc08634c21e6400af7b9d1a470b52285ebcd"
PIP = ("https://files.pythonhosted.org/packages/07/25/ee8c38ae72d66b844ce8eb9711ba905dba21ca1a8a0c960057c41cd23337/pip-26.3-py3-none-any.whl",
       1950951, "f3b60b20ffaadd4415ed7957212a38ac63fa4c5fa375bd0f4a797777940fad13")
SOURCES = (
    ("upstream.zip", f"https://github.com/rlleshi/phar/archive/{UPSTREAM}.zip", 438771,
     "80b8caf01c198e59fcb692b1afa913584cb50f3bb57e85c6b3e2b80e7798a777", "upstream"),
    ("mmaction2.zip", f"https://github.com/open-mmlab/mmaction2/archive/{MMACTION}.zip", 22607519,
     "158bfec444a4a65639b951e7879094c562afff90be3c16dd2820ac86909e7dfd", "upstream/mmaction2"),
)
TORCH = {
    "cpu": (
        "https://download.pytorch.org/whl/cpu/torch-1.13.1%2Bcpu-cp310-cp310-win_amd64.whl#sha256=207ab3700cd9c4349f4fd1892597eb3d385eb78221c0f2974ec54b8ea903aa00",
        "https://download.pytorch.org/whl/cpu/torchvision-0.14.1%2Bcpu-cp310-cp310-win_amd64.whl#sha256=9191ce52974a6be4f2f75a23d9c96371ac3025448dfd48ee0d2a553316944c4c"),
    "cuda": (
        "https://download.pytorch.org/whl/cu117/torch-1.13.1%2Bcu117-cp310-cp310-win_amd64.whl#sha256=978239684c6ec455ad2157ff33d44fdb9dd8d3a93b9d2f4ac7aa57691e990136",
        "https://download.pytorch.org/whl/cu117/torchvision-0.14.1%2Bcu117-cp310-cp310-win_amd64.whl#sha256=b39fc67e7131053d435804d7901e88528611c0832fd9f1cc26476b5a27cc5d81"),
}
# Freeze of the successful CPU environment; torch varies only by device build.
REQUIREMENTS = """absl-py==2.5.1
addict==2.4.0
certifi==2026.10.23
cffi==2.1.1
charset-normalizer==3.5.2
cloudpickle==3.1.2
contourpy==1.3.2
cryptography==50.0.2
cycler==0.12.1
einops==0.4.1
fonttools==4.65.0
google-auth==2.62.1
google-auth-oauthlib==1.0.0
grpcio==1.85.1
idna==3.20
joblib==1.6.0
kiwisolver==1.5.1
Markdown==3.10.3
MarkupSafe==3.0.4
matplotlib==3.7.5
mmcv==1.5.0
numpy==1.23.5
oauthlib==4.0.1
opencv-python==4.7.0.72
packaging==26.3
pandas==1.5.3
pillow==12.3.0
protobuf==7.36.2
pyasn1==0.6.5
pyasn1_modules==0.4.2
pycparser==3.11
pyparsing==3.3.3
python-dateutil==3.0.0
pytz==2026.6
PyYAML==6.0.2
regex==2026.9.29
requests==2.34.2
requests-oauthlib==2.0.0
scikit-learn==1.2.2
scipy==1.10.1
six==1.17.0
tensorboard==2.12.3
tensorboard-data-server==0.7.2
threadpoolctl==3.8.0
typing_extensions==4.16.0
tzdata==2026.6
urllib3==2.8.0
Werkzeug==3.1.9
yapf==0.32.0
"""


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix(".new")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    os.replace(temporary, path)


def progress(root, phase, percent, message):
    atomic_json(root / "runtime-progress.json", dict(phase=phase, progress_percent=percent, message=message))


def download(root, filename, url, size, digest):
    destination = root / "downloads" / filename
    destination.parent.mkdir(exist_ok=True)
    if destination.is_file() and destination.stat().st_size == size and sha256(destination) == digest:
        return destination
    partial = destination.with_suffix(".part")
    request = urllib.request.Request(url, headers={"User-Agent": "AvtoHmver-RGB-runtime"})
    received = 0
    with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            received += len(block)
            if received > size:
                raise RuntimeError(f"{filename} exceeds its pinned size")
            output.write(block)
    if received != size or sha256(partial) != digest:
        raise RuntimeError(f"{filename} failed exact size / SHA-256 verification")
    os.replace(partial, destination)
    return destination


def extract_source(archive, destination):
    # Archives have one revision-named root. Never accept traversal or symlinks.
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            parts = Path(member.filename).parts
            if len(parts) < 2:
                continue
            relative = Path(*parts[1:])
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unsafe source archive path")
            target = destination / relative
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(member) as incoming, target.open("wb") as output:
                    shutil.copyfileobj(incoming, output)


def pip(*arguments):
    subprocess.run([sys.executable, "-m", "pip", "--disable-pip-version-check", *arguments], check=True)


def probe(root, worker, backend):
    video = root / "upstream/mmaction2/demo/demo.mp4"
    device = "cpu" if backend == "cpu" else "cuda:0"
    started = time.perf_counter()
    completed = subprocess.run([sys.executable, str(worker), "--environment", str(root),
                                "--probe", "--video", str(video), "--device", device],
                               text=True, capture_output=True, timeout=600)
    print(completed.stderr, file=sys.stderr, flush=True)
    try:
        response = json.loads(completed.stdout)
    except ValueError as error:
        raise RuntimeError(f"Inference probe returned invalid JSON: {completed.stdout[-1000:]}") from error
    if completed.returncode or not response.get("ready"):
        raise RuntimeError(response.get("error", "Inference probe failed"))
    windows = response.get("result", {}).get("windows", [])
    if not windows or any(len(window.get("scores", {})) != 17 for window in windows):
        raise RuntimeError("Inference probe did not produce all 17 probabilities")
    return dict(backend=backend, device=device, video_sha256=sha256(video),
                elapsed_secs=time.perf_counter() - started, response=response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--backend", choices=("cpu", "cuda"), required=True)
    parser.add_argument("--allow-cpu-fallback", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:3] != (3, 10, 11):
        raise RuntimeError("Managed RGB runtime requires pinned Python 3.10.11")
    root, worker = args.environment.resolve(), args.worker.resolve()
    if Path(sys.executable).resolve() != root / "python/python.exe":
        raise RuntimeError("Provisioning must use the private managed interpreter")
    for name in ("tmp", "pip-cache", "matplotlib-cache", "torch-cache"):
        (root / name).mkdir(exist_ok=True)
    os.environ.update(TEMP=str(root / "tmp"), TMP=str(root / "tmp"),
                      PIP_CACHE_DIR=str(root / "pip-cache"),
                      MPLCONFIGDIR=str(root / "matplotlib-cache"),
                      TORCH_HOME=str(root / "torch-cache"))
    marker = root / "runtime.json"
    # Stale readiness must never survive a failed repair or inference test.
    marker.unlink(missing_ok=True)
    if not args.self_test:
        progress(root, "fetching_source", 15, "Fetching pinned P-HAR and MMAction RGB sources.")
        for name, url, size, digest, destination in SOURCES:
            extract_source(download(root, name, url, size, digest), root / destination)
        progress(root, "installing_dependencies", 30, "Installing private pinned RGB inference dependencies; downloads may be large.")
        try:
            import pip as installed_pip
            assert installed_pip.__version__ == "26.3"
        except (ImportError, AssertionError):
            wheel = download(root, "pip-26.3-py3-none-any.whl", *PIP)
            sys.path.insert(0, str(wheel))
            from pip._internal.cli.main import main as pip_main
            if pip_main(["install", "--no-deps", str(wheel)]) != 0:
                raise RuntimeError("Private pip bootstrap failed")
        pip("install", "--no-deps", "setuptools==69.5.1", "wheel==0.48.0", "packaging==26.3")
        pip("install", "--no-deps", *TORCH[args.backend])
        requirements = root / "rgb-requirements.txt"
        requirements.write_text(REQUIREMENTS, encoding="utf-8")
        pip("install", "--no-build-isolation", "--no-deps", "-r", str(requirements))
    progress(root, "probing", 85, "Loading the official checkpoint and running real neutral-video inference.")
    fallback_error = None
    try:
        measured = probe(root, worker, args.backend)
    except Exception as error:
        if args.backend != "cuda" or not args.allow_cpu_fallback:
            raise
        fallback_error = str(error)
        progress(root, "probing", 90, "GPU inference failed; measuring CPU fallback on the same real video.")
        measured = probe(root, worker, "cpu")
    import importlib.metadata
    runtime = dict(format="curator-phar-runtime-v2", upstream_revision=UPSTREAM,
                   mmaction_revision=MMACTION, managed_python=str(Path(sys.executable).resolve()),
                   backend=measured["backend"], device=measured["device"],
                   checkpoints_verified=True, inference_probe_passed=True,
                   artifact_hashes={"p-har-timesformer": "184163c9c527113432dc6bfb639e1e604614186d243a6006016772455024378f",
                                    "worker": sha256(worker), "phar-source": SOURCES[0][3], "mmaction-source": SOURCES[1][3]},
                   packages={name: importlib.metadata.version(name) for name in (
                       "torch", "torchvision", "mmcv", "numpy", "opencv-python", "einops")},
                   probe=measured, gpu_fallback_error=fallback_error,
                   accuracy_evaluated=False)
    atomic_json(marker, runtime)
    print(json.dumps(dict(ready=True, backend=runtime["backend"], probe=measured,
                         gpu_fallback_error=fallback_error), allow_nan=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps(dict(ready=False, error=str(error))), flush=True)
        sys.exit(1)
