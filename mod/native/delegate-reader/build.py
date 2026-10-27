"""Build only the owned reader DLL; dependency headers stay outside the repository."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parent
LOADER_SHA = 'ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def exports(path):
    data = path.read_bytes()
    u16 = lambda off: struct.unpack_from('<H', data, off)[0]
    u32 = lambda off: struct.unpack_from('<I', data, off)[0]
    pe = u32(0x3c)
    if data[pe:pe+4] != b'PE\0\0' or u16(pe+4) != 0x8664 or u16(pe+24) != 0x20b:
        raise ValueError('Expected verified Windows x64 PE32+ loader')
    optional = pe + 24
    sections_at = optional + u16(pe+20)
    sections = []
    for index in range(u16(pe+6)):
        at = sections_at + index*40
        sections.append((u32(at+12), max(u32(at+8), u32(at+16)), u32(at+20)))

    def raw(rva):
        for va, size, offset in sections:
            if va <= rva < va+size:
                return offset+rva-va
        raise ValueError('Export RVA is outside sections')

    at = raw(u32(optional+112))
    count = u32(at+24)
    if not 0 < count < 100000:
        raise ValueError('Invalid loader export count')
    table = raw(u32(at+32))
    names = []
    for index in range(count):
        start = raw(u32(table+index*4))
        name = data[start:data.index(b'\0', start)].decode('ascii')
        if '\n' in name or '\r' in name or '"' in name:
            raise ValueError('Unexpected export name')
        names.append(name)
    return names


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dependencies', type=Path, required=True, help='External root containing RE-UE4SS, UEPseudo and fmt')
    parser.add_argument('--loader', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--vcvars', type=Path, default=Path('C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat'))
    args = parser.parse_args()
    if digest(args.loader) != LOADER_SHA:
        raise ValueError('Loader identity is not the verified development fixture')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    deps = args.dependencies.resolve()
    sdk = deps / 'UEPseudo'
    public = deps / 'RE-UE4SS'
    includes = [sdk/'include', sdk/'include/Unreal/Core', sdk/'include/Unreal', sdk/'generated_include', public/'UE4SS/include', deps/'fmt/include', deps/'zydis/include', deps/'zycore/include']
    includes.extend(sorted(path for path in (public/'deps/first').glob('*/include') if path.is_dir()))
    if not all(path.is_dir() for path in includes):
        raise ValueError('Missing external pinned header directory')
    definition = output/'UE4SS.def'
    definition.write_text('LIBRARY UE4SS.dll\nEXPORTS\n'+''.join('    '+name+'\n' for name in exports(args.loader)), encoding='utf-8')
    include_flags = ' '.join('/I"'+str(path)+'"' for path in includes)
    flags = '/nologo /utf-8 /std:c++23preview /EHsc /MD /W4 /O2 /DNDEBUG /DUE_BUILD_SHIPPING=1 /DUBT_COMPILED_PLATFORM=Windows /DPLATFORM_WINDOWS=1 /DUNICODE /D_UNICODE /DZYDIS_STATIC_BUILD /DZYCORE_STATIC_BUILD /DFMT_HEADER_ONLY /D_ITERATOR_DEBUG_LEVEL=0 '
    script = output/'compile.cmd'
    script.write_text('@echo off\r\ncall "'+str(args.vcvars.resolve())+'"\r\nif errorlevel 1 exit /b 1\r\n'
        'lib.exe /nologo /machine:x64 /def:"'+str(definition)+'" /out:"'+str(output/'UE4SS.lib')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        'cl.exe '+flags+include_flags+' /LD "'+str(ROOT/'reader.cpp')+'" /Fo"'+str(output/'reader.obj')+'" /link /OUT:"'+str(output/'fanservice_delegate_reader.dll')+'" "'+str(output/'UE4SS.lib')+'" bcrypt.lib\r\nif errorlevel 1 exit /b 1\r\n'
        'cl.exe '+flags+' "'+str(ROOT/'contract_test.cpp')+'" /Fo"'+str(output/'contract_test.obj')+'" /Fe"'+str(output/'contract_test.exe')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        '"'+str(output/'contract_test.exe')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        'cl.exe '+flags+' "'+str(ROOT/'root_lease_test.cpp')+'" /Fo"'+str(output/'root_lease_test.obj')+'" /Fe"'+str(output/'root_lease_test.exe')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        '"'+str(output/'root_lease_test.exe')+'"\r\nif errorlevel 1 exit /b 1\r\n'
        'cl.exe '+flags+' "'+str(ROOT/'beat_guard_test.cpp')+'" /Fo"'+str(output/'beat_guard_test.obj')+'" /Fe"'+str(output/'beat_guard_test.exe')+'"\r\n'
        'if errorlevel 1 exit /b 1\r\n"'+str(output/'beat_guard_test.exe')+'"\r\nexit /b %errorlevel%\r\n',encoding='utf-8')
    result = subprocess.run(['cmd.exe', '/d', '/c', str(script)], cwd=output, capture_output=True)
    (output/'build.log').write_bytes(result.stdout+result.stderr)
    print(result.stdout.decode(errors='replace')[-12000:])
    print(result.stderr.decode(errors='replace')[-3000:])
    result.check_returncode()
    headers = {str(path.relative_to(deps)): digest(path) for base in includes if base.is_relative_to(deps) for path in base.rglob('*') if path.is_file()}
    sources = {path.name: digest(path) for path in ROOT.iterdir() if path.is_file()}
    manifest = {'game_sha256':'c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f', 'loader_sha256':LOADER_SHA,
        'public_commit':'8333063595fa3c49ad307f3b0f732accbb760d25', 'sdk_commit':'fbb4fdd3fffc59d5b5268b23a643f500f702115e',
        'fmt_header_version':'11.0.2', 'sources':sources, 'dependency_header_hashes':headers,
        'dll_sha256':digest(output/'fanservice_delegate_reader.dll'), 'tests':'contract_test.exe, root_lease_test.exe and beat_guard_test.exe passed; game runtime not executed',
        'installed':False, 'api':'FanserviceReadCheckedBindings(addressInteger,kindInteger,indexInteger) -> count,addressInteger,functionString',
        'scratch_api':'FanserviceCreateScratchRoot(gameInstanceAddress) -> token,managerAddress; FanserviceReleaseScratchRoot(token) -> bool',
        'guard_api':'FanserviceScratchGuardStatus(token) -> accepted,suppressed,malformed,changed,generation,bypassed,deferred; FanserviceSetScratchClock(token,position,playing) -> true'}
    manifest['audio_api']='FanserviceCreateAudioRoot(actorAddress) -> token,playerAddress; FanserviceReleaseAudioRoot(token) -> bool'
    (output/'build-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print('DLL SHA-256:', manifest['dll_sha256'])


if __name__ == '__main__':
    main()
