#!/usr/bin/env python3
"""Minimal UE5 legacy .uasset/.uexp reader for the CockHero v0.05.1 evidence work.

Reads retoc to-legacy output (legacy package format, version fields written as 0
by retoc — layout is assumed UE5.3). Provides:
  - package summary, name map, import map, export map
  - FPropertyTag walker over export data in the .uexp (for DataTables and CDOs)
  - Kismet bytecode scanner for function calls (for the #48 counting question)

Not a general-purpose parser; validates as it goes and fails loudly.
"""
import struct, sys, json

def u32(b, o): return struct.unpack_from('<I', b, o)[0]
def i32(b, o): return struct.unpack_from('<i', b, o)[0]
def i64(b, o): return struct.unpack_from('<q', b, o)[0]
def f32(b, o): return struct.unpack_from('<f', b, o)[0]
def f64(b, o): return struct.unpack_from('<d', b, o)[0]

class Reader:
    def __init__(self, data, off=0):
        self.d = data; self.o = off
    def i32(self): v = i32(self.d, self.o); self.o += 4; return v
    def u32(self): v = u32(self.d, self.o); self.o += 4; return v
    def i64(self): v = i64(self.d, self.o); self.o += 8; return v
    def u64(self): v = struct.unpack_from('<Q', self.d, self.o)[0]; self.o += 8; return v
    def u16(self): v = struct.unpack_from('<H', self.d, self.o)[0]; self.o += 2; return v
    def i16(self): v = struct.unpack_from('<h', self.d, self.o)[0]; self.o += 2; return v
    def f32(self): v = f32(self.d, self.o); self.o += 4; return v
    def f64(self): v = f64(self.d, self.o); self.o += 8; return v
    def byte(self): v = self.d[self.o]; self.o += 1; return v
    def bool(self): return self.byte() != 0
    def bytes(self, n): v = self.d[self.o:self.o+n]; self.o += n; return v
    def fname(self):  # FName = int32 index + int32 number
        return (self.i32(), self.i32())
    def fstring(self):
        ln = self.i32()
        if ln == 0: return ''
        if ln < 0:
            n = -ln
            raw = self.bytes(n*2)
            s = raw.decode('utf-16-le', errors='replace')
            return s.rstrip('\x00')
        raw = self.bytes(ln)
        return raw.decode('utf-8', errors='replace').rstrip('\x00')

class Package:
    def __init__(self, uasset_path):
        self.path = uasset_path
        self.data = open(uasset_path, 'rb').read()
        uexp_path = uasset_path[:-len('.uasset')] + '.uexp'
        try:
            self.uexp = open(uexp_path, 'rb').read()
        except FileNotFoundError:
            self.uexp = b''
        self._parse_summary()

    def _parse_summary(self):
        r = Reader(self.data)
        assert r.u32() == 0x9E2A83C1, 'bad magic'
        self.legacy_ver = r.i32()
        self.legacy_ue3 = r.i32()
        self.ver_ue4 = r.i32()
        self.ver_ue5 = r.i32()
        self.ver_licensee = r.u32()
        # custom versions (present when LegacyFileVersion <= -2; retoc writes -8)
        ncv = r.i32()
        assert 0 <= ncv < 1000, f'implausible custom version count {ncv}'
        for _ in range(ncv):
            r.bytes(16); r.i32()
        self.total_header_size = r.i32()
        self.folder = r.fstring()
        self.flags = r.u32()
        self.name_count = r.i32()
        self.name_off = r.i32()
        # UE5 soft object paths list
        self.soft_obj_count = r.i32()
        self.soft_obj_off = r.i32()
        self.text_count = r.i32()
        self.text_off = r.i32()
        self.export_count = r.i32()
        self.export_off = r.i32()
        self.import_count = r.i32()
        self.import_off = r.i32()
        self.depends_off = r.i32()
        self.soft_ref_count = r.i32()
        self.soft_ref_off = r.i32()
        self.searchable_off = r.i32()
        self.thumbnail_off = r.i32()
        self.guid = r.bytes(16)
        ngen = r.i32()
        self.generations = []
        for _ in range(ngen):
            self.generations.append((r.i32(), r.i32()))
        # engine versions
        self.saved_engine = self._engine_version(r)
        self.compat_engine = self._engine_version(r)
        self.compression_flags = r.u32()
        ncc = r.i32()
        for _ in range(ncc):
            r.i32(); r.i32(); r.i32(); r.i32()
        self.package_source = r.u32()
        nap = r.i32()
        self.additional_packages = [r.fstring() for _ in range(nap)]
        self.asset_registry_off = r.i32()
        self.bulk_start = r.i64()
        self.world_tile_off = r.i32()
        nchunk = r.i32()
        self.chunk_ids = [r.i32() for _ in range(nchunk)]
        self.preload_count = r.i32()
        self.preload_off = r.i32()
        self._parse_names()
        self._parse_imports()
        self._parse_exports()

    def _engine_version(self, r):
        major = r.u16(); minor = r.u16(); patch = r.u16(); cl = r.u32(); branch = r.fstring()
        return (major, minor, patch, cl, branch)

    def _parse_names(self):
        r = Reader(self.data, self.name_off)
        self.names = []
        for _ in range(self.name_count):
            s = r.fstring()
            _hash = r.u32()  # retoc legacy output: one u32 hash per name (written 0)
            self.names.append(s)
        self.name_end = r.o

    def name(self, idx):
        if idx < 0 or idx >= len(self.names): return f'<badname {idx}>'
        return self.names[idx]

    def fname_str(self, fn):
        idx, num = fn
        s = self.name(idx)
        return f'{s}_{num-1}' if num > 0 else s

    def _parse_imports(self):
        r = Reader(self.data, self.import_off)
        self.imports = []
        for _ in range(self.import_count):
            # retoc legacy import entry: ClassPackage, ClassName, OuterIndex,
            # ObjectName (FNames) + one trailing int32 (written 0).
            cp = r.fname(); cn = r.fname(); outer = r.i32(); on = r.fname()
            _extra = r.i32()
            self.imports.append({'class_package': self.fname_str(cp), 'class': self.fname_str(cn),
                                 'outer': outer, 'name': self.fname_str(on)})

    def _parse_exports(self):
        # retoc's legacy writer emits export entries whose dependency section
        # varies in size; entry boundaries are recovered by scanning for the
        # next plausible entry whose .uexp offset continues the chain
        # (export data is laid out in map order: off[i+1] == off[i] + size[i]).
        r = Reader(self.data, self.export_off)
        self.exports = []
        o = self.export_off
        prev_off = None
        prev_size = None
        for _ in range(self.export_count):
            cls, sup, tpl, out = struct.unpack_from('<4i', self.data, o)
            nidx, nnum = struct.unpack_from('<2i', self.data, o + 16)
            flags = struct.unpack_from('<I', self.data, o + 24)[0]
            size, off = struct.unpack_from('<2q', self.data, o + 28)
            e = {'class': cls, 'super': sup, 'template': tpl, 'outer': out,
                 'name': self.fname_str((nidx, nnum)), 'flags': flags,
                 'size': size, 'offset': off}
            self.exports.append(e)
            if prev_off is not None and off != prev_off + prev_size:
                raise ValueError(f"export offset chain broken at {e['name']}: "
                                 f"{off} != {prev_off}+{prev_size}")
            if len(self.exports) == self.export_count:
                break
            nxt = None
            cands = []
            for cand in range(o + 88, o + 600):
                if self._plausible_entry(cand):
                    s2, o2 = struct.unpack_from('<2q', self.data, cand + 28)
                    cands.append((cand, s2, o2))
            for cand, s2, o2 in cands:
                if o2 == off + size or (size == 0 and o2 == off):
                    nxt = cand
                    break
            if nxt is None and cands:
                # offset chain broken (e.g. unordered exports): take the first
                # plausible entry and record the anomaly
                nxt = cands[0][0]
                print(f'WARN: offset chain broken after {e["name"]}: '
                      f'next at {nxt} off {cands[0][2]} vs expected {off + size}',
                      file=sys.stderr)
            if nxt is None:
                raise ValueError(f"could not find entry after {e['name']}")
            prev_off, prev_size = off, size
            o = nxt

    def _plausible_entry(self, o):
        try:
            cls, sup, tpl, out, nidx, nnum = struct.unpack_from('<6i', self.data, o)
            flags = struct.unpack_from('<I', self.data, o + 24)[0]
            size, off = struct.unpack_from('<2q', self.data, o + 28)
            lim = max(self.export_count, self.import_count) + 100
            return (-10000 < cls < lim and -10000 < sup < lim and -10000 < tpl < lim
                    and -10000 < out < lim and 0 <= nidx < len(self.names)
                    and 0 <= nnum < 100000 and flags < 0x1000000
                    and 0 <= size < 20000000 and 0 <= off < 30000000)
        except Exception:
            return False

    def find_export(self, name):
        return [e for e in self.exports if e['name'] == name]

    def export_data(self, e):
        # SerialOffset is in the combined (.uasset + .uexp) stream; the .uexp
        # starts at TotalHeaderSize.
        off = e['offset'] - self.total_header_size
        return self.uexp[off:off + e['size']]

    def resolve_pkg_index(self, idx):
        """FPackageIndex: 0=null, <0 import (-idx-1), >0 export (idx-1)."""
        if idx == 0: return '<null>'
        if idx < 0:
            i = -idx - 1
            return self.imports[i]['name'] if 0 <= i < len(self.imports) else f'<badimport {idx}>'
        i = idx - 1
        return self.exports[i]['name'] if 0 <= i < len(self.exports) else f'<badexport {idx}>'

# ---------------- FPropertyTag walker ----------------
class PropWalker:
    """Walks a UE5 FPropertyTag stream. Calls visitor(name, type, value, raw) for
    each property; struct/array/map values are returned as nested structures."""
    def __init__(self, pkg):
        self.pkg = pkg

    def walk(self, data, off=0, end=None):
        r = Reader(data, off)
        out = []
        if end is None: end = len(data)
        while r.o < end:
            name_idx, name_num = r.fname()
            if name_idx == 0 and name_num == 0:
                # 'None' terminator is index of "None" name; detect by string
                pass
            name = self.pkg.name(name_idx)
            if name == 'None':
                break
            typ = self.pkg.name(r.fname()[0])
            size = r.i64()
            arr_idx = r.i32()
            val_start = r.o
            extra = {}
            if typ == 'StructProperty':
                extra['struct'] = self.pkg.name(r.fname()[0])
                r.bytes(16)  # struct guid
            elif typ == 'BoolProperty':
                pass
            elif typ == 'ByteProperty':
                extra['enum'] = self.pkg.name(r.fname()[0])
            elif typ == 'EnumProperty':
                extra['enum'] = self.pkg.name(r.fname()[0])
            elif typ == 'ArrayProperty':
                extra['inner'] = self.pkg.name(r.fname()[0])
            elif typ == 'MapProperty':
                extra['key'] = self.pkg.name(r.fname()[0])
                extra['value'] = self.pkg.name(r.fname()[0])
            elif typ == 'SetProperty':
                extra['elem'] = self.pkg.name(r.fname()[0])
            val = self._read_value(r, typ, size, extra)
            # skip to end of this property's declared size if the reader drifted
            expect = val_start + size
            if r.o != expect:
                r.o = expect
            out.append({'name': name, 'type': typ, 'size': size, 'arr_idx': arr_idx,
                        'value': val, 'extra': extra})
        return out

    def _read_value(self, r, typ, size, extra):
        if typ == 'IntProperty': return r.i32()
        if typ == 'Int64Property': return r.i64()
        if typ == 'UInt32Property': return r.u32()
        if typ == 'UInt64Property': return r.u64()
        if typ == 'FloatProperty': return r.f32()
        if typ == 'DoubleProperty': return r.f64()
        if typ == 'BoolProperty': return r.bool()
        if typ == 'ByteProperty': return r.byte()
        if typ == 'NameProperty': return self.pkg.fname_str(r.fname())
        if typ == 'StrProperty': return r.fstring()
        if typ == 'TextProperty':
            # FText: flags(4) + history type(1) + ... simplified: raw skip
            return {'text_raw': r.bytes(size).hex()}
        if typ == 'ObjectProperty' or typ == 'SoftObjectProperty' or typ == 'LazyObjectProperty' or typ == 'WeakObjectProperty':
            return self.pkg.resolve_pkg_index(r.i32())
        if typ == 'StructProperty':
            return self.walk(r.d, r.o, r.o + size)
        if typ == 'ArrayProperty':
            n = r.i32()
            inner = extra.get('inner')
            items = []
            for _ in range(n):
                items.append(self._read_value(r, inner, 0, {}))
            return items
        if typ == 'MapProperty':
            n = r.i32()
            pairs = []
            for _ in range(n):
                k = self._read_value(r, extra.get('key'), 0, {})
                v = self._read_value(r, extra.get('value'), 0, {})
                pairs.append((k, v))
            return pairs
        if typ == 'EnumProperty':
            return self.pkg.fname_str(r.fname())
        if typ == 'MulticastDelegateProperty' or typ == 'DelegateProperty':
            return {'delegate_raw': r.bytes(size).hex()}
        if typ == 'InterfaceProperty':
            return self.pkg.resolve_pkg_index(r.i32())
        if typ == 'FieldPathProperty':
            return {'fieldpath_raw': r.bytes(size).hex()}
        return {'raw': r.bytes(size).hex()}

def dump_props(props, indent=0):
    lines = []
    for p in props:
        v = p['value']
        if isinstance(v, list) and v and isinstance(v[0], dict) and 'name' in v[0]:
            lines.append('  '*indent + f"{p['name']} ({p['type']}) {p['extra']}:")
            lines.extend(dump_props(v, indent+1))
        elif isinstance(v, list) and v and isinstance(v[0], tuple):
            lines.append('  '*indent + f"{p['name']} ({p['type']}) {len(v)} pairs:")
            for k, vv in v:
                if isinstance(vv, list) and vv and isinstance(vv[0], dict) and 'name' in vv[0]:
                    lines.append('  '*(indent+1) + f'{k}:')
                    lines.extend(dump_props(vv, indent+2))
                else:
                    lines.append('  '*(indent+1) + f'{k}: {vv}')
        else:
            lines.append('  '*indent + f"{p['name']} ({p['type']}) = {v}")
    return lines

if __name__ == '__main__':
    p = Package(sys.argv[1])
    print(f"names={p.name_count} imports={p.import_count} exports={p.export_count} folder={p.folder}")
    print(f"ver ue4={p.ver_ue4} ue5={p.ver_ue5} saved_engine={p.saved_engine}")
    print("first 20 names:", p.names[:20])
    print("exports:")
    for e in p.exports[:40]:
        print(f"  {e['name']} class={p.resolve_pkg_index(e['class'])} outer={p.resolve_pkg_index(e['outer'])} size={e['size']} off={e['offset']}")
