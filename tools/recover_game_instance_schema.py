"""Extend an uncompressed v4 usmap from extracted GameInstance metadata.

Only BP_CHGameInstance_C is replaced. Other schemas and enum records are
preserved byte-for-byte. This does not establish runtime or UI defaults.
"""
import argparse
import json
import struct
from pathlib import Path


def extend(source, metadata):
    magic, version, compression, extra, packed, unpacked = struct.unpack_from('<HBiBII', source)
    if (magic, version, compression, extra) != (0x30C4, 4, 0, 0):
        raise ValueError('Requires uncompressed usmap version 4 without extensions')
    body, pos = source[16:], 0
    if len(body) != packed or packed != unpacked:
        raise ValueError('Invalid usmap body length')

    def get(fmt):
        nonlocal pos
        values = struct.unpack_from(fmt, body, pos)
        pos += struct.calcsize(fmt)
        return values[0] if len(values) == 1 else values

    names = []
    for _ in range(get('<I')):
        size = get('<H')
        names.append(body[pos:pos + size].decode('utf-8'))
        pos += size
    enum_start = pos
    for _ in range(get('<I')):
        _, count = get('<iH')
        pos += count * 12
    enum_end = pos

    def skip_type():
        kind = get('<B')
        if kind == 9:
            get('<i')
        elif kind in (8, 25):
            skip_type()
        elif kind == 24:
            skip_type()
            skip_type()
        elif kind == 26:
            skip_type()
            get('<i')

    schemas = []
    for _ in range(get('<I')):
        start = pos
        owner, parent, count, serialized = get('<iiHH')
        for _ in range(serialized):
            get('<HBi')
            skip_type()
        schemas.append((names[owner], owner, parent, body[start:pos]))
    if pos != len(body):
        raise ValueError('Unparsed usmap data')
    target = 'BP_CHGameInstance_C'
    exports = [e for e in metadata['Exports'] if e['ObjectName'] == target]
    if len(exports) != 1 or len(exports[0]['LoadedProperties']) != 49:
        raise ValueError('Expected one current GameInstance with 49 properties')
    fields = exports[0]['LoadedProperties']

    def name_id(name):
        if name not in names:
            names.append(name)
        return names.index(name)

    def reference(index):
        if index >= 0:
            raise ValueError('Expected an imported type')
        return metadata['Imports'][-index - 1]['ObjectName']

    simple = {'ByteProperty': 0, 'BoolProperty': 1, 'IntProperty': 2,
              'FloatProperty': 3, 'ObjectProperty': 4, 'NameProperty': 5,
              'DoubleProperty': 7, 'StrProperty': 10, 'TextProperty': 11}

    def encode(prop):
        kind = prop['SerializedType']
        if kind in simple:
            return bytes([simple[kind]])
        if kind == 'StructProperty':
            return struct.pack('<Bi', 9, name_id(reference(prop['Struct'])))
        if kind == 'EnumProperty':
            return bytes([26]) + encode(prop['UnderlyingProp']) + struct.pack('<i', name_id(reference(prop['Enum'])))
        if kind == 'ArrayProperty':
            return bytes([8]) + encode(prop['Inner'])
        if kind == 'MapProperty':
            return bytes([24]) + encode(prop['KeyProp']) + encode(prop['ValueProp'])
        raise ValueError(f'Unsupported metadata property type: {kind}')

    output_schemas, replaced = [], 0
    for name, owner, parent, raw in schemas:
        if name == target:
            if names[parent] != 'GameInstance':
                raise ValueError('Unexpected GameInstance superclass')
            inherited = [s for s in schemas if s[0] == 'GameInstance']
            if len(inherited) != 1 or struct.unpack_from('<H', inherited[0][3], 8)[0] != 6:
                raise ValueError('Expected six inherited GameInstance fields')
            raw = struct.pack('<iiHH', owner, parent, len(fields), len(fields))
            for index, prop in enumerate(fields):
                raw += struct.pack('<HBi', index, 1, name_id(prop['Name'])) + encode(prop)
            replaced += 1
        output_schemas.append(raw)
    if replaced != 1:
        raise ValueError('Expected exactly one GameInstance schema')
    result = struct.pack('<I', len(names))
    for name in names:
        value = name.encode('utf-8')
        result += struct.pack('<H', len(value)) + value
    result += body[enum_start:enum_end] + struct.pack('<I', len(schemas)) + b''.join(output_schemas)
    return struct.pack('<HBiBII', magic, version, compression, extra, len(result), len(result)) + result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('metadata', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; choose a new mapping path')
    recovered = extend(args.source.read_bytes(), json.loads(args.metadata.read_text(encoding='utf-8-sig')))
    with args.output.open('xb') as stream:
        stream.write(recovered)
    print(f'Wrote {len(recovered)} bytes; replaced BP_CHGameInstance_C with 49 metadata fields')
