"""Corrected Kismet bytecode parser (v2).

Key correction vs v1: UE5 property pointers (XFER_PROP_POINTER) are FFieldPath,
not a bare int32:
    int32 numEntries; numEntries x FName(8B each); FPackageIndex owner(4B)
On disk size = 4 + 8*n + 4. In iCode a property pointer is 8 bytes.
This is what misaligned v1 at the ubergraph prologue (the 0x55 byte inside the
'EntryPoint' FName was mistaken for EX_InterfaceToObjCast).

Tracks both storage (on-disk) and iCode offsets. Records FinalFunction calls
(esp. UpdateMetric) with their iCode offsets so they can be attributed to the
containing function via the stub entry offsets (which are iCode offsets).
"""
import struct

TOK = {
    0x00:'LocalVariable',0x01:'InstanceVariable',0x02:'DefaultVariable',
    0x04:'Return',0x06:'Jump',0x07:'JumpIfNot',0x09:'Assert',0x0b:'Nothing',
    0x0f:'Let',0x12:'ClassContext',0x13:'MetaCast',0x14:'LetBool',
    0x15:'EndParmValue',0x16:'EndFunctionParms',0x17:'Self',0x18:'Skip',
    0x19:'Context',0x1a:'ContextFailSilent',0x1b:'VirtualFunction',
    0x1c:'FinalFunction',0x1d:'IntConst',0x1e:'FloatConst',0x1f:'StringConst',
    0x20:'ObjectConst',0x21:'NameConst',0x22:'RotationConst',0x23:'VectorConst',
    0x24:'ByteConst',0x25:'IntZero',0x26:'IntOne',0x27:'True',0x28:'False',
    0x29:'TextConst',0x2a:'NoObject',0x2b:'TransformConst',0x2c:'IntConstByte',
    0x2d:'NoInterface',0x2e:'DynamicCast',0x2f:'StructConst',0x30:'EndStructConst',
    0x31:'SetArray',0x32:'EndArray',0x33:'PropertyConst',0x34:'UnicodeStringConst',
    0x35:'Int64Const',0x36:'UInt64Const',0x37:'DoubleConst',0x38:'PrimitiveCast',0x39:'SetSet',
    0x3a:'EndSet',0x3b:'SetMap',0x3c:'EndMap',0x3d:'SetConst',0x3e:'EndSetConst',
    0x3f:'MapConst',0x40:'EndMapConst',0x42:'StructMemberContext',
    0x43:'LetMulticastDelegate',0x44:'LetDelegate',0x45:'LocalVirtualFunction',
    0x46:'LocalFinalFunction',0x48:'LocalOutVariable',0x4a:'DeprecatedOp4A',
    0x4b:'InstanceDelegate',0x4c:'PushExecutionFlow',0x4d:'PopExecutionFlow',
    0x4e:'ComputedJump',0x4f:'PopExecutionFlowIfNot',0x50:'Breakpoint',
    0x51:'InterfaceContext',0x52:'ObjToInterfaceCast',0x53:'EndOfScript',
    0x54:'CrossInterfaceCast',0x55:'InterfaceToObjCast',0x56:'WireTracepoint',
    0x5a:'WireTracepoint2',0x5b:'SkipOffsetConst',0x5c:'AddMulticastDelegate',
    0x5d:'ClearMulticastDelegate',0x5e:'Tracepoint',0x5f:'LetObj',
    0x60:'LetWeakObjPtr',0x61:'BindDelegate',0x62:'RemoveMulticastDelegate',
    0x63:'CallMulticastDelegate',0x64:'LetValueOnPersistentFrame',
    0x65:'ArrayConst',0x66:'EndArrayConst',0x67:'SoftObjectConst',
    0x68:'CallMath',0x69:'SwitchValue',0x6a:'InstrumentationEvent',
    0x6b:'ArrayGetByRef',0x6c:'ClassSparseDataVariable',0x6d:'FieldPathConst',
}
# tokens whose operand is a property pointer (FFieldPath)
PROP_PTR = {0x00,0x01,0x02,0x33,0x6c}
# cast tokens: ClassPtr(FPackageIndex) + target expr (NOT PrimitiveCast 0x38)
CAST = {0x2e,0x52,0x54,0x55}

class ParseError(Exception):
    pass

class Parser:
    def __init__(self, data, pkg, icode_base=0, large_world=True):
        self.d = data
        self.pkg = pkg
        self.large_world = large_world  # UE5 LARGE_WORLD_COORDINATES: FVector/FRotator/FTransform are double-precision
        self.events = []      # (kind, storage_off, icode_off, detail)
        self.calls = []       # (storage_off, icode_off, func_idx, params_summary)
        self.max_icode = 0
    # --- primitive readers (storage) ---
    def u8(self, p):
        if p >= len(self.d): raise ParseError(f'u8 past end @{p}')
        return self.d[p], p+1
    def i32(self, p):
        if p+4 > len(self.d): raise ParseError(f'i32 past end @{p}')
        return struct.unpack_from('<i', self.d, p)[0], p+4
    def u32(self, p):
        if p+4 > len(self.d): raise ParseError(f'u32 past end @{p}')
        return struct.unpack_from('<I', self.d, p)[0], p+4
    def i64(self, p):
        if p+8 > len(self.d): raise ParseError(f'i64 past end @{p}')
        return struct.unpack_from('<q', self.d, p)[0], p+8
    def f32(self, p):
        if p+4 > len(self.d): raise ParseError(f'f32 past end @{p}')
        return struct.unpack_from('<f', self.d, p)[0], p+4
    def f64(self, p):
        if p+8 > len(self.d): raise ParseError(f'f64 past end @{p}')
        return struct.unpack_from('<d', self.d, p)[0], p+8
    def fname(self, p):
        idx, p = self.i32(p); num, p = self.i32(p)
        return (idx, num), p
    def fstring(self, p):
        n, p = self.i32(p)
        if n < 0:  # unicode
            n = -n
            if p+2*n > len(self.d): raise ParseError('unicode fstring past end')
            s = self.d[p:p+2*n].decode('utf-16-le', 'replace'); p += 2*n
            return s, p, 4+2*n
        if n == 0: return '', p, 4
        if p+n > len(self.d): raise ParseError('fstring past end')
        s = self.d[p:p+n-1].decode('utf-8', 'replace'); p += n
        return s, p, 4+n
    def fpackageindex(self, p):
        v, p = self.i32(p); return v, p
    def fieldpath(self, p):
        """FFieldPath: int32 count, count x FName, FPackageIndex owner.
        Returns (names, owner, storage_bytes)."""
        n, p = self.i32(p)
        if n < 0 or n > 64: raise ParseError(f'fieldpath bad count {n} @{p-4}')
        names = []
        for _ in range(n):
            fn, p = self.fname(p); names.append(fn)
        owner, p = self.fpackageindex(p)
        return (names, owner), p
    # --- expression parser ---
    def parse_expr(self, sp, ip):
        """Parse one expression starting at storage pos sp, icode pos ip.
        Returns (sp_end, ip_end, info_dict)."""
        if sp >= len(self.d): raise ParseError(f'expr past end @{sp}')
        tok = self.d[sp]
        name = TOK.get(tok, f'UNKNOWN_0x{tok:02x}')
        sp0, ip0 = sp, ip
        sp += 1; ip += 1  # token byte
        info = {'tok': tok, 'name': name, 'sp': sp0, 'ip': ip0}
        if tok in PROP_PTR:
            (names, owner), sp = self.fieldpath(sp)
            ip += 8
            info['fieldpath'] = (names, owner)
        elif tok == 0x04:  # Return
            sp, ip, sub = self.parse_expr(sp, ip); info['ret'] = sub
        elif tok == 0x06:  # Jump
            v, sp = self.u32(sp); ip += 4; info['offset'] = v
        elif tok == 0x07:  # JumpIfNot
            v, sp = self.u32(sp); ip += 4; info['offset'] = v
            sp, ip, sub = self.parse_expr(sp, ip); info['cond'] = sub
        elif tok == 0x09:  # Assert
            v, sp = self.u32(sp); ip += 4; info['line'] = v
            sp, ip, sub = self.parse_expr(sp, ip); info['cond'] = sub
        elif tok in (0x0b, 0x15, 0x16, 0x17, 0x25, 0x26, 0x27, 0x28, 0x2a,
                     0x2d, 0x30, 0x32, 0x3a, 0x3c, 0x3e, 0x40, 0x4d, 0x50,
                     0x53, 0x66):
            pass  # no operand
        elif tok == 0x0f:  # Let (UE5: leading Value prop pointer)
            (names, owner), sp = self.fieldpath(sp); ip += 8
            info['value_prop'] = (names, owner)
            sp, ip, var = self.parse_expr(sp, ip); info['var'] = var
            sp, ip, ex = self.parse_expr(sp, ip); info['expr'] = ex
        elif tok in (0x14, 0x5f, 0x60, 0x43, 0x44):  # LetBool/LetObj/LetWeakObjPtr/LetMulticastDelegate/LetDelegate
            sp, ip, var = self.parse_expr(sp, ip); info['var'] = var
            sp, ip, ex = self.parse_expr(sp, ip); info['expr'] = ex
        elif tok == 0x12:  # ClassContext
            sp, ip, sub = self.parse_expr(sp, ip); info['ctx'] = sub
        elif tok == 0x13:  # MetaCast
            v, sp = self.fpackageindex(sp); ip += 8; info['class'] = v
            sp, ip, sub = self.parse_expr(sp, ip); info['target'] = sub
        elif tok == 0x18:  # Skip
            v, sp = self.u32(sp); ip += 4; info['skip'] = v
            sp, ip, sub = self.parse_expr(sp, ip); info['expr'] = sub
        elif tok in (0x19, 0x1a):  # Context / ContextFailSilent: obj expr + uint32 offset + FFieldPath rvalue + ctx expr (UAssetAPI EX_Context)
            sp, ip, obj = self.parse_expr(sp, ip); info['obj'] = obj
            v, sp = self.u32(sp); ip += 4; info['offset'] = v
            (names, owner), sp = self.fieldpath(sp); ip += 8
            info['rvalue'] = (names, owner)
            sp, ip, ctx = self.parse_expr(sp, ip); info['ctx'] = ctx
        elif tok == 0x51:  # InterfaceContext: ONE expr only (UAssetAPI EX_InterfaceContext: InterfaceValue). NOT the Context layout.
            sp, ip, sub = self.parse_expr(sp, ip); info['iface'] = sub
        elif tok in (0x1b, 0x45):  # VirtualFunction / LocalVirtualFunction
            (idx, num), sp = self.fname(sp); ip += 12; info['funcname'] = (idx, num)
            params = []
            while True:
                if sp >= len(self.d): raise ParseError('VirtualFunction params past end')
                if self.d[sp] == 0x16:  # EndFunctionParms
                    sp += 1; ip += 1; break
                sp, ip, prm = self.parse_expr(sp, ip); params.append(prm)
            info['params'] = params
        elif tok in (0x1c, 0x46, 0x68):  # FinalFunction / LocalFinalFunction / CallMath
            v, sp = self.fpackageindex(sp); ip += 8; info['func'] = v
            params = []
            while True:
                if sp >= len(self.d): raise ParseError('FinalFunction params past end')
                if self.d[sp] == 0x16:
                    sp += 1; ip += 1; break
                sp, ip, prm = self.parse_expr(sp, ip); params.append(prm)
            info['params'] = params
            if tok in (0x1c, 0x46):
                self.calls.append((sp0, ip0, v, self._summ_params(params)))
        elif tok == 0x1d:  # IntConst
            v, sp = self.i32(sp); ip += 4; info['value'] = v
        elif tok == 0x1e:  # FloatConst
            v, sp = self.f32(sp); ip += 4; info['value'] = v
        elif tok == 0x1f:  # StringConst: XFERSTRING = null-terminated UTF-8 (NO length prefix)
            end = self.d.index(b'\x00', sp)
            s = self.d[sp:end].decode('utf-8', 'replace')
            sp = end + 1; ip += len(s)+1; info['value'] = s
        elif tok == 0x20:  # ObjectConst
            v, sp = self.fpackageindex(sp); ip += 8; info['obj'] = v
        elif tok == 0x21:  # NameConst
            (idx, num), sp = self.fname(sp); ip += 12; info['name_const'] = (idx, num)
        elif tok in (0x22, 0x23):  # RotationConst / VectorConst: 3 doubles (24 B) in large-world UE5, else 3 floats (12 B)
            vals = []
            n = 24 if self.large_world else 12
            for _ in range(3):
                v, sp = (self.f64(sp) if self.large_world else self.f32(sp)); vals.append(v)
            ip += n; info['value'] = vals
        elif tok == 0x24:  # ByteConst
            v, sp = self.u8(sp); ip += 1; info['value'] = v
        elif tok == 0x29:  # TextConst: FScriptText — 1-byte EBlueprintTextLiteralType, then type-dependent fields (UAssetAPI FScriptText).
            # 0 Empty, 1 LocalizedText (source/key/namespace exprs), 2 InvariantText (one string expr),
            # 3 LiteralString (one string expr), 4 StringTableEntry (FPackageIndex + id/key exprs).
            # The string payloads are nested Kismet expressions (usually EX_StringConst), NOT raw FStrings —
            # the old raw-FString read consumed following bytecode as string data.
            ltype, sp = self.u8(sp); ip += 1; info['texttype'] = ltype
            if ltype == 0:  # Empty
                pass
            elif ltype == 1:  # LocalizedText
                for k in ('src', 'key', 'ns'):
                    sp, ip, sub = self.parse_expr(sp, ip); info[k] = sub
            elif ltype in (2, 3):  # InvariantText / LiteralString
                sp, ip, sub = self.parse_expr(sp, ip); info['value'] = sub
            elif ltype == 4:  # StringTableEntry
                v, sp = self.fpackageindex(sp); ip += 8; info['table'] = v
                sp, ip, sub = self.parse_expr(sp, ip); info['tableid'] = sub
                sp, ip, sub = self.parse_expr(sp, ip); info['tablekey'] = sub
            else:
                raise ParseError(f'TextConst unknown literal type {ltype} @{sp0}')
        elif tok == 0x2b:  # TransformConst: 80 B in large-world UE5 (quat+trans+scale all double), else 40 B
            n = 80 if self.large_world else 40
            sp += n; ip += n
        elif tok == 0x2c:  # IntConstByte
            v, sp = self.u8(sp); ip += 1; info['value'] = v
        elif tok == 0x38:  # PrimitiveCast: 1-byte ECastToken, then target.
            # ECastToken: 0=ObjectToInterface (adds 8B interface-class ptr in iCode only),
            # 1=InterfaceToObj, 2=ObjectToBool, 3=InterfaceToBool (no extra iCode bytes).
            conv, sp = self.u8(sp); ip += 1; info['conv'] = conv
            if conv == 0: ip += 8
            sp, ip, sub = self.parse_expr(sp, ip); info['target'] = sub
        elif tok in CAST:  # DynamicCast/ObjToInterfaceCast/CrossInterfaceCast/InterfaceToObjCast
            v, sp = self.fpackageindex(sp); ip += 8; info['class'] = v
            sp, ip, sub = self.parse_expr(sp, ip); info['target'] = sub
        elif tok == 0x2f:  # StructConst
            v, sp = self.fpackageindex(sp); ip += 8; info['struct'] = v
            sz, sp = self.i32(sp); ip += 4; info['size'] = sz
            vals = []
            while True:
                if sp >= len(self.d): raise ParseError('StructConst vals past end')
                if self.d[sp] == 0x30:
                    sp += 1; ip += 1; break
                sp, ip, val = self.parse_expr(sp, ip); vals.append(val)
            info['vals'] = vals
        elif tok in (0x31, 0x39, 0x3b, 0x3d, 0x3f):  # SetArray/SetSet/SetMap/SetConst/MapConst
            sp, ip, ap = self.parse_expr(sp, ip); info['assign'] = ap
            endtok = {0x31:0x32, 0x39:0x3a, 0x3b:0x3c, 0x3d:0x3e, 0x3f:0x40}[tok]
            vals = []
            while True:
                if sp >= len(self.d): raise ParseError('Set/Map vals past end')
                if self.d[sp] == endtok:
                    sp += 1; ip += 1; break
                sp, ip, val = self.parse_expr(sp, ip); vals.append(val)
            info['vals'] = vals
        elif tok == 0x34:  # UnicodeStringConst: XFERUNICODESTRING = null-terminated UTF-16
            end = sp
            while True:
                if self.d[end:end+2] == b'\x00\x00': break
                end += 2
            s = self.d[sp:end].decode('utf-16-le', 'replace')
            sp = end + 2; ip += 2*(len(s)+1); info['value'] = s
        elif tok in (0x35, 0x36):  # Int64/UInt64Const
            v, sp = self.i64(sp); ip += 8; info['value'] = v
        elif tok == 0x37:  # DoubleConst
            v = struct.unpack_from('<d', self.d, sp)[0]; sp += 8; ip += 8; info['value'] = v
        elif tok == 0x42:  # StructMemberContext: prop pointer FIRST, then struct expr
            (names, owner), sp = self.fieldpath(sp); ip += 8
            info['member'] = (names, owner)
            sp, ip, sub = self.parse_expr(sp, ip); info['struct_expr'] = sub
        elif tok == 0x48:  # LocalOutVariable
            (names, owner), sp = self.fieldpath(sp); ip += 8
            info['fieldpath'] = (names, owner)
        elif tok == 0x4b:  # InstanceDelegate
            (idx, num), sp = self.fname(sp); ip += 12; info['funcname'] = (idx, num)
            sp, ip, sub = self.parse_expr(sp, ip); info['obj'] = sub
        elif tok == 0x4c:  # PushExecutionFlow
            v, sp = self.u32(sp); ip += 4; info['addr'] = v
        elif tok == 0x4e:  # ComputedJump
            sp, ip, sub = self.parse_expr(sp, ip); info['offset_expr'] = sub
        elif tok == 0x4f:  # PopExecutionFlowIfNot
            sp, ip, sub = self.parse_expr(sp, ip); info['cond'] = sub
        elif tok == 0x5b:  # SkipOffsetConst
            v, sp = self.u32(sp); ip += 4; info['offset'] = v
        elif tok in (0x5c, 0x62):  # AddMulticastDelegate / RemoveMulticastDelegate: two exprs (UAssetAPI)
            sp, ip, a = self.parse_expr(sp, ip); info['a'] = a
            sp, ip, b = self.parse_expr(sp, ip); info['b'] = b
        elif tok == 0x5d:  # ClearMulticastDelegate: ONE expr (UAssetAPI EX_ClearMulticastDelegate: DelegateToClear only)
            sp, ip, a = self.parse_expr(sp, ip); info['a'] = a
        elif tok == 0x61:  # BindDelegate: FName FunctionName + Delegate expr + ObjectTerm expr (UAssetAPI EX_BindDelegate).
            # The leading FName is why the old two-expr read misaligned here: its
            # first byte (a name index, e.g. 0x91) was mistaken for a token.
            (idx, num), sp = self.fname(sp); ip += 12; info['funcname'] = (idx, num)
            sp, ip, a = self.parse_expr(sp, ip); info['delegate'] = a
            sp, ip, b = self.parse_expr(sp, ip); info['obj'] = b
        elif tok == 0x63:  # CallMulticastDelegate: FPackageIndex StackNode + Delegate expr + params (UAssetAPI EX_CallMulticastDelegate, subclass of EX_FinalFunction)
            v, sp = self.fpackageindex(sp); ip += 8; info['func'] = v
            sp, ip, d = self.parse_expr(sp, ip); info['delegate'] = d
            params = []
            while True:
                if sp >= len(self.d): raise ParseError('CallMulticastDelegate params past end')
                if self.d[sp] == 0x16:
                    sp += 1; ip += 1; break
                sp, ip, prm = self.parse_expr(sp, ip); params.append(prm)
            info['params'] = params
            self.calls.append((sp0, ip0, v, self._summ_params(params)))
        elif tok == 0x64:  # LetValueOnPersistentFrame
            (names, owner), sp = self.fieldpath(sp); ip += 8
            info['value_prop'] = (names, owner)
            sp, ip, var = self.parse_expr(sp, ip); info['var'] = var
            sp, ip, ex = self.parse_expr(sp, ip); info['expr'] = ex
        elif tok == 0x65:  # ArrayConst
            v, sp = self.fpackageindex(sp); ip += 8; info['inner'] = v
            n, sp = self.i32(sp); ip += 4; info['count'] = n
            vals = []
            while True:
                if sp >= len(self.d): raise ParseError('ArrayConst vals past end')
                if self.d[sp] == 0x66:
                    sp += 1; ip += 1; break
                sp, ip, val = self.parse_expr(sp, ip); vals.append(val)
            info['vals'] = vals
        elif tok == 0x67:  # SoftObjectConst
            sp, ip, sub = self.parse_expr(sp, ip); info['path'] = sub
        elif tok == 0x69:  # SwitchValue
            sp, ip, val = self.parse_expr(sp, ip); info['value_expr'] = val
            # cases: (index_expr, jump_offset, case_expr) repeated until default jump?
            # Layout: int32 numCases? Actually: Value expr, then for each case:
            #   case value expr, uint32 jump, case expr ... ends with a default?
            # This is complex; record raw and bail to caller via exception with position.
            raise ParseError(f'SwitchValue not implemented @{sp0}')
        elif tok == 0x6b:  # ArrayGetByRef
            sp, ip, a = self.parse_expr(sp, ip); info['a'] = a
            sp, ip, b = self.parse_expr(sp, ip); info['b'] = b
        elif tok == 0x6d:  # FieldPathConst
            (names, owner), sp = self.fieldpath(sp); ip += 8
            info['fieldpath'] = (names, owner)
        else:
            raise ParseError(f'unhandled token 0x{tok:02x} ({name}) at storage {sp0} icode {ip0}')
        if ip > self.max_icode: self.max_icode = ip
        return sp, ip, info
    def _summ_params(self, params):
        out = []
        for prm in params:
            out.append(self._summ(prm))
        return out
    def _summ(self, e):
        t = e['name']
        if t == 'ByteConst': return ('byte', e['value'])
        if t == 'IntConst': return ('int', e['value'])
        if t == 'FloatConst': return ('float', e['value'])
        if t == 'IntZero': return ('int', 0)
        if t == 'IntOne': return ('int', 1)
        if t == 'True': return ('bool', True)
        if t == 'False': return ('bool', False)
        if t == 'Nothing': return ('nothing',)
        if t in ('LocalVariable','InstanceVariable','DefaultVariable'):
            fp = e.get('fieldpath')
            if fp:
                names, owner = fp
                nm = self.pkg.name(names[0][0]) if names else '?'
                return (t, nm, owner)
            return (t,)
        if t == 'FinalFunction':
            return ('call', e['func'], self._summ_params(e.get('params', [])))
        return (t,)

def parse_script(data, pkg, large_world=True):
    """Parse a whole ubergraph script (top-level statement list).
    Returns (parser, statements). Stops at EndOfScript or end of data."""
    pr = Parser(data, pkg, large_world=large_world)
    stmts = []
    sp, ip = 0, 0
    while sp < len(data):
        if data[sp] == 0x53:  # EndOfScript
            sp += 1; ip += 1
            break
        try:
            sp2, ip2, info = pr.parse_expr(sp, ip)
        except ParseError as ex:
            return pr, stmts, (sp, ip, str(ex))
        stmts.append(info)
        sp, ip = sp2, ip2
    return pr, stmts, None
