"""Synthetic-usmap tests for tools/recover_game_instance_schema.py.

These use a hand-built mapping, not game data. They check the patcher's own
claims (only BP_CHGameInstance_C is replaced; everything else is preserved
byte-for-byte; unsupported or unresolvable types fail closed). They say
nothing about the real extracted asset or runtime defaults.
"""
import copy
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from recover_game_instance_schema import extend  # noqa: E402

TARGET = 'BP_CHGameInstance_C'
BASE_NAMES = ['GameInstance', TARGET, 'OtherClass', 'Alpha', 'Beta', 'MyEnum', 'E_A', 'E_B']
# Enum record: name index, entry count, then 12 bytes per entry (as the tool parses them).
ENUM_RECORD = struct.pack('<iH', 5, 2) + struct.pack('<iq', 6, 0) + struct.pack('<iq', 7, 1)


def prop(index, name_idx, type_bytes):
    return struct.pack('<HBi', index, 1, name_idx) + type_bytes


def schema(owner, parent, props):
    raw = struct.pack('<iiHH', owner, parent, len(props), len(props))
    return raw + b''.join(props)


def build_usmap(inherited_count=6):
    names_blob = struct.pack('<I', len(BASE_NAMES))
    for name in BASE_NAMES:
        data = name.encode()
        names_blob += struct.pack('<H', len(data)) + data
    game_instance = schema(0, -1, [prop(i, 3, bytes([2])) for i in range(inherited_count)])
    old_target = schema(1, 0, [prop(i, 4, bytes([2])) for i in range(16)])
    other = schema(2, 0, [prop(0, 3, struct.pack('<Bi', 9, 4))])
    body = (names_blob + struct.pack('<I', 1) + ENUM_RECORD
            + struct.pack('<I', 3) + game_instance + old_target + other)
    header = struct.pack('<HBiBII', 0x30C4, 4, 0, 0, len(body), len(body))
    return header + body, {'game_instance': game_instance, 'other': other, 'enum': ENUM_RECORD}


def make_metadata(count=49, types=None):
    imports = [
        {'ObjectName': 'SomeStruct'},   # index -1
        {'ObjectName': 'SomeEnum'},     # index -2
    ]
    cycle = types or [
        {'SerializedType': 'IntProperty'},
        {'SerializedType': 'BoolProperty'},
        {'SerializedType': 'FloatProperty'},
        {'SerializedType': 'StrProperty'},
        {'SerializedType': 'StructProperty', 'Struct': -1},
        {'SerializedType': 'EnumProperty', 'Enum': -2,
         'UnderlyingProp': {'SerializedType': 'ByteProperty'}},
        {'SerializedType': 'ArrayProperty', 'Inner': {'SerializedType': 'StructProperty', 'Struct': -1}},
        {'SerializedType': 'MapProperty', 'KeyProp': {'SerializedType': 'NameProperty'},
         'ValueProp': {'SerializedType': 'IntProperty'}},
    ]
    props = []
    for i in range(count):
        entry = copy.deepcopy(cycle[i % len(cycle)])
        entry['Name'] = f'Field{i}'
        props.append(entry)
    return {'Imports': imports, 'Exports': [{'ObjectName': TARGET, 'LoadedProperties': props}]}


class Parsed:
    """Independent reader for the usmap layout the tool emits."""

    def __init__(self, data):
        self.data = data
        self.magic, self.version, self.compression, self.extra, self.packed, self.unpacked = \
            struct.unpack_from('<HBiBII', data)
        body, pos = data[16:], 0
        count = struct.unpack_from('<I', body, pos)[0]; pos += 4
        self.names = []
        for _ in range(count):
            size = struct.unpack_from('<H', body, pos)[0]; pos += 2
            self.names.append(body[pos:pos + size].decode()); pos += size
        enum_count = struct.unpack_from('<I', body, pos)[0]; pos += 4
        enum_start = pos
        for _ in range(enum_count):
            _, n = struct.unpack_from('<iH', body, pos); pos += 6 + n * 12
        self.enum_bytes = body[enum_start:pos]

        def skip_type():
            nonlocal pos
            kind = body[pos]; pos += 1
            if kind == 9:
                pos += 4
            elif kind in (8, 25):
                skip_type()
            elif kind == 24:
                skip_type(); skip_type()
            elif kind == 26:
                skip_type(); pos += 4
            return kind

        schema_count = struct.unpack_from('<I', body, pos)[0]; pos += 4
        self.schemas = []
        for _ in range(schema_count):
            start = pos
            owner, parent, count, serialized = struct.unpack_from('<iiHH', body, pos); pos += 12
            props = []
            for _ in range(serialized):
                idx, _arr, name = struct.unpack_from('<HBi', body, pos); pos += 7
                kind = skip_type()
                props.append((idx, self.names[name], kind))
            self.schemas.append({'owner': self.names[owner], 'parent': parent, 'props': props,
                                 'raw': body[start:pos]})
        self.consumed_all = pos == len(body)


class RecoverSchemaTests(unittest.TestCase):
    def setUp(self):
        self.source, self.original = build_usmap()
        self.result = extend(self.source, make_metadata())
        self.parsed = Parsed(self.result)

    def test_output_is_well_formed_and_fully_consumed(self):
        self.assertTrue(self.parsed.consumed_all)
        self.assertEqual(self.parsed.packed, len(self.result) - 16)
        self.assertEqual(self.parsed.packed, self.parsed.unpacked)
        self.assertEqual((self.parsed.magic, self.parsed.version, self.parsed.compression), (0x30C4, 4, 0))

    def test_only_target_schema_is_replaced(self):
        by_owner = {s['owner']: s for s in self.parsed.schemas}
        self.assertEqual(by_owner['GameInstance']['raw'], self.original['game_instance'])
        self.assertEqual(by_owner['OtherClass']['raw'], self.original['other'])
        self.assertEqual(self.parsed.enum_bytes, self.original['enum'])
        self.assertEqual(len(self.parsed.schemas), 3)

    def test_target_has_49_fields_in_metadata_order_with_expected_types(self):
        target = next(s for s in self.parsed.schemas if s['owner'] == TARGET)
        self.assertEqual([p[1] for p in target['props']], [f'Field{i}' for i in range(49)])
        self.assertEqual([p[0] for p in target['props']], list(range(49)))
        expected_kinds = [2, 1, 3, 10, 9, 26, 8, 24]
        self.assertEqual([p[2] for p in target['props'][:8]], expected_kinds)

    def test_negative_imports_resolve_to_import_names(self):
        for name in ('SomeStruct', 'SomeEnum'):
            self.assertIn(name, self.parsed.names)

    def test_original_names_keep_their_indices(self):
        self.assertEqual(self.parsed.names[:len(BASE_NAMES)], BASE_NAMES)

    def test_rejects_non_negative_type_reference(self):
        meta = make_metadata(types=[{'SerializedType': 'StructProperty', 'Struct': 3}])
        with self.assertRaises(ValueError):
            extend(self.source, meta)

    def test_rejects_unsupported_property_type(self):
        meta = make_metadata(types=[{'SerializedType': 'SoftObjectProperty'}])
        with self.assertRaises(ValueError):
            extend(self.source, meta)

    def test_rejects_wrong_field_count(self):
        with self.assertRaises(ValueError):
            extend(self.source, make_metadata(count=48))

    def test_rejects_missing_or_duplicate_target_export(self):
        meta = make_metadata()
        meta['Exports'][0]['ObjectName'] = 'Something_C'
        with self.assertRaises(ValueError):
            extend(self.source, meta)
        meta = make_metadata()
        meta['Exports'].append(copy.deepcopy(meta['Exports'][0]))
        with self.assertRaises(ValueError):
            extend(self.source, meta)

    def test_rejects_wrong_inherited_field_count(self):
        source, _ = build_usmap(inherited_count=5)
        with self.assertRaises(ValueError):
            extend(source, make_metadata())

    def test_rejects_compressed_or_trailing_garbage_input(self):
        compressed = bytearray(self.source)
        struct.pack_into('<i', compressed, 3, 3)
        with self.assertRaises(ValueError):
            extend(bytes(compressed), make_metadata())
        with self.assertRaises(ValueError):
            extend(self.source + b'\x00', make_metadata())

    def test_is_idempotent_in_shape_on_repeat_extension(self):
        # Running again on already-extended output must fail closed or keep the same fields.
        try:
            again = extend(self.result, make_metadata())
        except ValueError:
            return
        target = next(s for s in Parsed(again).schemas if s['owner'] == TARGET)
        self.assertEqual(len(target['props']), 49)


if __name__ == '__main__':
    unittest.main()
