"""Populate only a marked acceptance fixture with generated, non-personal media."""
import argparse
import json
import math
from pathlib import Path
import shutil
import sqlite3
import struct
import subprocess
import urllib.request
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / ".parity-fixture").is_file():
        raise SystemExit("Refusing an unmarked fixture directory")
    ready = json.loads((root / "ready.json").read_text())
    data = Path(ready["data_dir"]).resolve()
    library = Path(ready["library_dir"]).resolve()
    if not data.is_relative_to(root) or not library.is_relative_to(root):
        raise SystemExit("Fixture paths escape the marked directory")
    database = data / "data.db"
    if not database.is_file() or not args.ffmpeg:
        raise SystemExit("Start the acceptance launcher and provide FFmpeg first")
    if (root / "seeded.json").is_file():
        raise SystemExit("This fixture was already seeded; preserving its manual test state")
    connection = sqlite3.connect(database, timeout=30)
    if connection.execute("SELECT COUNT(*) FROM media").fetchone()[0] or connection.execute("SELECT COUNT(*) FROM sources").fetchone()[0]:
        raise SystemExit("Refusing to overwrite an occupied fixture library")
    assets = root / "generated"
    assets.mkdir(exist_ok=True)

    def ffmpeg(*options):
        result = subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *map(str, options)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise SystemExit(result.stderr.decode(errors="replace"))

    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=240x480:rate=1", "-frames:v", 8, assets / "image-%d.png")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=240x480:rate=15", "-t", 4, "-c:v", "libx264", "-pix_fmt", "yuv420p", assets / "portrait.mp4")
    connection.execute("PRAGMA foreign_keys=ON")
    for index in range(1, 111):
        slug = f"fixture-{index:03}"
        connection.execute("INSERT INTO sources(id,url,name,slug,added_at,included,status,item_count) VALUES(?,?,?,?,?,0,'paused',1)",
                           (index, f"https://example.com/parity/{index}", f"Parity source {index:03}", slug, "2026-10-26"))
        folder = library / slug
        folder.mkdir(exist_ok=True)
        target = folder / "portrait.png"
        shutil.copyfile(assets / f"image-{(index - 1) % 8 + 1}.png", target)
        connection.execute("INSERT INTO media(source_id,filepath,filename,type,added_at,downloaded,rating,file_size_bytes,nsfw_state) VALUES(?,?,?,'image',?,1,?,?,'done')",
                           (index, f"{slug}/portrait.png", f"Parity image {index:03}.png", "2026-10-26", index % 5 + 1, target.stat().st_size))
    videos = []
    for index in range(3):
        target = library / "fixture-001" / f"video-{index}.mp4"
        shutil.copyfile(assets / "portrait.mp4", target)
        cursor = connection.execute("INSERT INTO media(source_id,filepath,filename,type,added_at,downloaded,rating,file_size_bytes,duration_secs,nsfw_state) VALUES(1,?,?,'video',?,1,?,?,4,'done')",
                                    (f"fixture-001/video-{index}.mp4", f"Parity video {index}.mp4", "2026-10-26", index + 2, target.stat().st_size))
        videos.append(cursor.lastrowid)
    cursor = connection.execute("INSERT INTO media(source_id,filepath,filename,type,added_at,downloaded,rating,file_size_bytes,duration_secs,clip_parent_id,clip_start_secs,clip_end_secs,nsfw_state) VALUES(1,'virtual-clips/parity','Parity virtual clip','clip','2026-10-26',1,3,0,2,?,0.5,2.5,'done')", (videos[0],))
    virtual_clip = cursor.lastrowid
    broken = library / "fixture-001" / "broken.mp4"
    broken.write_bytes(b"deliberately invalid preview fixture")
    cursor = connection.execute("INSERT INTO media(source_id,filepath,filename,type,added_at,downloaded,rating,file_size_bytes,nsfw_state) VALUES(1,'fixture-001/broken.mp4','Preview failure fixture','video','2026-10-26',1,2,?,'done')", (broken.stat().st_size,))
    broken_id = cursor.lastrowid
    connection.execute("UPDATE sources SET item_count=(SELECT COUNT(*) FROM media WHERE source_id=sources.id)")
    connection.commit()

    origin = f"http://127.0.0.1:{ready['port']}"
    urllib.request.urlopen(origin + "/api/music/tracks", timeout=10).close()
    music = data / "music"
    music.mkdir(exist_ok=True)
    track = music / "1.wav"
    rate = 22050
    with wave.open(str(track), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        frames = bytearray()
        for sample in range(rate * 24):
            phase = sample % (rate // 2)
            value = 6000 * math.sin(phase * 2 * math.pi * 1000 / rate) * math.exp(-phase / 160) if phase < 1500 else 0
            frames.extend(struct.pack("<h", int(value)))
        output.writeframes(frames)
    connection.execute("INSERT INTO music_tracks(id,title,format,bytes) VALUES(1,'Parity 120 BPM click track','wav',?)", (track.stat().st_size,))
    connection.commit()
    request = urllib.request.Request(origin + "/api/goon/playlists", data=json.dumps({"name": "Parity local music", "provider": "local", "source_url": None, "tracks": [1]}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        playlist = json.load(response)
    report = {"images": 110, "video_ids": videos, "virtual_clip_id": virtual_clip, "broken_id": broken_id, "track_id": 1, "playlist": playlist, "origin": origin}
    (root / "seeded.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
