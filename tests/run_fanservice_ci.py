"""Run the browser test against an isolated Rust fixture; never open a user library."""
import os
import json
from pathlib import Path
import subprocess
import time
import urllib.request

output = Path(os.environ.get('FANSERVICE_SMOKE_OUTPUT', 'fanservice-ci-results')).resolve()
output.mkdir(parents=True, exist_ok=True)
origin = 'http://127.0.0.1:42169'
env = dict(os.environ, FANSERVICE_FIXTURE_ORIGIN=origin, FANSERVICE_SMOKE_OUTPUT=str(output))
# Keep the standard three-image fixture deterministic, even on developer machines.
env.pop('FANSERVICE_FIXTURE_VIDEO', None)
music = output / 'synthetic-tone.m4a'
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
                '-c:a', 'aac', str(music)], check=True)
env['FANSERVICE_FIXTURE_MUSIC'] = str(music)
with (output / 'fixture.log').open('w', encoding='utf-8') as log:
    process = subprocess.Popen([
        'cargo', 'test', '-p', 'avtohmver', '--lib', '--locked',
        'routes::fanservice::tests::lite_browser_fixture', '--', '--ignored', '--nocapture',
    ], stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=os.name != 'nt')
    try:
        deadline = time.monotonic() + 300
        while True:
            if process.poll() is not None:
                raise RuntimeError('Fixture exited before becoming ready; see fixture.log')
            try:
                with urllib.request.urlopen(origin + '/api/fanservice/v1/capabilities', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError('Fixture readiness timed out; see fixture.log')
            time.sleep(0.5)
        with urllib.request.urlopen(origin + '/api/fanservice/v1/music/1') as response:
            recording = json.load(response)
        beatmap = dict(recording_id=recording['recording_id'], duration=12,
                       bpm=120, offset=0, confirmed=True,
                       beats=[dict(time=i * .5, type='stroke') for i in range(24)],
                       events=[dict(time=0, type='media_change', value='slow'),
                               dict(time=10, type='cum_event', value='start')])
        request = urllib.request.Request(origin + '/api/fanservice/v1/music/1/beatmap',
                  data=json.dumps(beatmap).encode(), method='PUT',
                  headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
        subprocess.run(['node', 'tests/fanservice_browser_smoke.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', 'tests/fanservice_export_smoke.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', 'tests/fanservice_mobile_smoke.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', 'tests/fanservice_flow_smoke.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', 'tests/fanservice_economy_smoke.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', 'tests/fanservice_media_smoke.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', '--test', 'tests/fanservice_snapshot_pins.test.cjs'], env=env, check=True, timeout=120)
        subprocess.run(['node', 'tests/fanservice_voice_smoke.cjs'], env=env, check=True, timeout=120)
    finally:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], check=False)
        else:
            # cargo is a parent of the test executable: terminate the entire fixture group.
            import signal
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=15)
