"""Build the exact-build read-only CEF readiness module and its contract test."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('reader_build',ROOT.parent/'delegate-reader/build.py')
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--dependencies',type=Path,required=True)
    p.add_argument('--loader',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--vcvars',type=Path,default=Path('C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat'))
    args=p.parse_args()
    if reader.digest(args.loader)!=reader.LOADER_SHA:raise ValueError('Expected pinned development loader.')
    deps=args.dependencies.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    sdk=deps/'UEPseudo';public=deps/'RE-UE4SS'
    includes=[sdk/'include',sdk/'include/Unreal/Core',sdk/'include/Unreal',sdk/'generated_include',public/'UE4SS/include',deps/'fmt/include',deps/'zydis/include',deps/'zycore/include']
    includes.extend(sorted(path for path in (public/'deps/first').glob('*/include') if path.is_dir()))
    if not all(path.is_dir() for path in includes):raise ValueError('Missing pinned external headers.')
    definition=out/'UE4SS.def'
    definition.write_text('LIBRARY UE4SS.dll\nEXPORTS\n'+''.join('    '+name+'\n' for name in reader.exports(args.loader)))
    flags='/nologo /utf-8 /std:c++23preview /EHsc /MD /W4 /O2 /DNDEBUG /DUE_BUILD_SHIPPING=1 /DUBT_COMPILED_PLATFORM=Windows /DPLATFORM_WINDOWS=1 /DUNICODE /D_UNICODE /DZYDIS_STATIC_BUILD /DZYCORE_STATIC_BUILD /DFMT_HEADER_ONLY /D_ITERATOR_DEBUG_LEVEL=0 '
    include_flags=' '.join('/I"'+str(path)+'"' for path in includes)
    script=out/'compile.cmd'
    script.write_text('@echo off\r\ncall "'+str(args.vcvars.resolve())+'"\r\nif errorlevel 1 exit /b 1\r\n'
        'lib.exe /nologo /machine:x64 /def:"'+str(definition)+'" /out:"'+str(out/'UE4SS.lib')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        'cl.exe '+flags+include_flags+' /LD "'+str(ROOT/'reader.cpp')+'" /Fo"'+str(out/'reader.obj')+'" /link /OUT:"'+str(out/'fanservice-cef-ready.dll')+'" "'+str(out/'UE4SS.lib')+'" bcrypt.lib\r\nif errorlevel 1 exit /b 1\r\n'
        'cl.exe /nologo /utf-8 /std:c++20 /EHsc /MD /W4 /O2 "'+str(ROOT/'contract_test.cpp')+'" /Fo"'+str(out/'contract.obj')+'" /Fe"'+str(out/'contract.exe')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        '"'+str(out/'contract.exe')+'"\r\nexit /b %errorlevel%\r\n')
    result=subprocess.run(['cmd.exe','/d','/c',str(script)],cwd=out,capture_output=True)
    (out/'build.log').write_bytes(result.stdout+result.stderr)
    print(result.stdout.decode(errors='replace')[-6000:]);print(result.stderr.decode(errors='replace')[-1000:]);result.check_returncode()
    manifest={'game_sha256':'a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10','loader_sha256':reader.LOADER_SHA,
        'sources':{p.name:reader.digest(p) for p in ROOT.iterdir() if p.is_file()},'dll_sha256':reader.digest(out/'fanservice-cef-ready.dll'),
        'public_commit':'8333063595fa3c49ad307f3b0f732accbb760d25','sdk_commit':'fbb4fdd3fffc59d5b5268b23a643f500f702115e',
        'api':'FanserviceCefReady() -> readyBoolean,stateString','scope':'read-only exact native startup state; no game functions invoked','tests':'contract.exe passed','installed':False}
    (out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
