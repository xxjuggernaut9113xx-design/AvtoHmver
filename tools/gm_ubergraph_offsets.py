"""Compute statement byte offsets for the BP_GlobalManager ubergraph AST JSON
(reJOIce `functions/BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json`).

Usage: python tools/gm_ubergraph_offsets.py <ExecuteUbergraph AST json> [anchor ...]
Prints the validation (jump targets aligned, context-offset mismatches, total
size vs the stmt-0 push address) and resolves each anchor (a byte offset) to a
statement index. Sizes follow the in-memory script layout from UAssetAPI's
`Analysis/bytecode-size-source/*.cs` Visit methods (pointers 8 bytes, FName 12
bytes, EX_Context = opcode + object + 4 + 8 + context, function calls add one
EX_EndFunctionParms byte). The build uses UE5 large world coordinates, so
FVector/FRotator consts are 24 bytes (doubles) and FTransform is 80 bytes
(EX_VectorConst/EX_RotationConst/EX_TransformConst Visit in that source);
with 40-byte transforms only 92/299 jump targets align, with 80-byte
transforms 299/299 align. Self-check: every EX_Jump/EX_JumpIfNot/
EX_PushExecutionFlow target lands on a statement start and every EX_Context
`Offset` equals the computed size of its context expression. For the
2026-10-17 GlobalManager ubergraph: 2570 statements, 99921 bytes, 299/299
jump-target occurrences aligned (280 distinct), 0 context-offset mismatches.
The stmt-0 push address 99918 is the epilogue Return statement (stmt 2568),
not the script end (99918 + 2 + 1 EndOfScript = 99921), so the total is exact.
This validation is internal consistency, not a comparison with the original
engine's serialized offsets. The same model also resolves the UI_Manager
ubergraph (EX_InterfaceContext = opcode + interface value expression):
705 statements, 25010 bytes, 0 unaligned targets — used for the TauntButton
click entry 21921 -> stmt 609 and the T-key entry 8529 -> stmt 236.
"""
import json, sys
src = sys.argv[1]
anchors = [int(a) for a in sys.argv[2:]]
d = json.load(open(src, encoding='utf-8'))
S = d['statements']
bad = []


def fs(s):
    # FString inside FScriptText: 2 + UTF-8 length (validated by the jump
    # targets; the standalone FString size is not distinguished here because
    # every FScriptText field in this file is a dict with a Value key).
    if s is None:
        return 1
    if isinstance(s, dict):
        return 2 + len(str(s.get('Value', '')).encode('utf-8'))
    return 1 + len(s.encode('utf-8'))


def sz(x):
    o = x['op']
    if o in ('EX_LocalVariable', 'EX_InstanceVariable', 'EX_DefaultVariable', 'EX_LocalOutVariable'):
        return 9
    if o in ('EX_IntConst', 'EX_FloatConst', 'EX_SkipOffsetConst'):
        return 5
    if o == 'EX_DoubleConst':
        return 9
    if o == 'EX_Int64Const':
        return 9
    if o == 'EX_ByteConst':
        return 2
    if o in ('EX_True', 'EX_False', 'EX_Self', 'EX_Nothing', 'EX_NoObject', 'EX_EndOfScript', 'EX_PopExecutionFlow'):
        return 1
    if o == 'EX_NameConst':
        return 13
    if o == 'EX_ObjectConst':
        return 9
    if o == 'EX_StringConst':
        return 2 + len(x['Value'].encode('ascii'))
    if o == 'EX_UnicodeStringConst':
        return 3 + 2 * len(x['Value'])
    if o in ('EX_VectorConst', 'EX_RotationConst'):
        return 25  # opcode + 24 (large world coordinates: doubles)
    if o == 'EX_TransformConst':
        return 81  # opcode + 80 (large world coordinates)
    if o == 'EX_TextConst':
        t = x['Value']
        lt = t.get('TextLiteralType')
        n = 2  # opcode + TextLiteralType
        if lt == 'LocalizedText':
            n += fs(t.get('LocalizedNamespace')) + fs(t.get('LocalizedKey')) + fs(t.get('LocalizedSource'))
        elif lt == 'InvariantText':
            n += fs(t.get('InvariantLiteralString') or t.get('LiteralString'))
        elif lt == 'Empty':
            pass
        else:
            raise Exception('texttype ' + str(lt))
        return n
    if o == 'EX_Let':
        return 1 + 8 + sz(x['Variable']) + sz(x['Expression'])
    if o in ('EX_LetBool', 'EX_LetObj'):
        return 1 + sz(x['VariableExpression']) + sz(x['AssignmentExpression'])
    if o == 'EX_Jump':
        return 5
    if o == 'EX_JumpIfNot':
        return 5 + sz(x['BooleanExpression'])
    if o == 'EX_PushExecutionFlow':
        return 5
    if o == 'EX_PopExecutionFlowIfNot':
        return 1 + sz(x['BooleanExpression'])
    if o == 'EX_ComputedJump':
        return 1 + sz(x['CodeOffsetExpression'])
    if o == 'EX_Return':
        return 1 + sz(x['ReturnExpression'])
    if o in ('EX_FinalFunction', 'EX_LocalFinalFunction', 'EX_CallMath'):
        return 1 + 8 + sum(sz(p) for p in x['Parameters']) + 1
    if o in ('EX_LocalVirtualFunction', 'EX_VirtualFunction'):
        return 1 + 12 + sum(sz(p) for p in x['Parameters']) + 1
    if o == 'EX_Context':
        c = sz(x['ContextExpression'])
        if c != x['Offset']:
            bad.append(('ctxoffset', x['Offset'], c))
        return 1 + sz(x['ObjectExpression']) + 4 + 8 + c
    if o == 'EX_InterfaceContext':
        return 1 + sz(x['InterfaceValue'])
    if o == 'EX_StructMemberContext':
        return 1 + 8 + sz(x['StructExpression'])
    if o == 'EX_DynamicCast':
        return 1 + 8 + sz(x['Target'])
    if o == 'EX_PrimitiveCast':
        return 1 + 1 + sz(x['Target'])
    if o == 'EX_StructConst':
        return 1 + 8 + 4 + sum(sz(v) for v in x['Value']) + 1
    if o == 'EX_SetArray':
        return 1 + sz(x['AssigningProperty']) + sum(sz(e) for e in x['Elements']) + 1
    if o == 'EX_BindDelegate':
        return 1 + 12 + sz(x['Delegate']) + sz(x['ObjectTerm'])
    if o == 'EX_AddMulticastDelegate':
        return 1 + sz(x['Delegate']) + sz(x['DelegateToAdd'])
    if o == 'EX_ClearMulticastDelegate':
        return 1 + sz(x['DelegateToClear'])
    raise Exception(o)


rows = []
off = 0
for i, s in enumerate(S):
    n = sz(s)
    rows.append((i, off, n, s['op']))
    off += n
by = {r[1]: r[0] for r in rows}
print('statements', len(S), 'size', off, 'ctx-offset mismatches', len(bad), bad[:5])
miss = []
for (i, o, n, op), s in zip(rows, S):
    t = s.get('CodeOffset') if op in ('EX_Jump', 'EX_JumpIfNot') else s.get('PushingAddress') if op == 'EX_PushExecutionFlow' else None
    if t is not None and t not in by:
        miss.append((i, t))
print('unaligned targets', len(miss), miss[:10])
print('stmt-0 push address', S[0].get('PushingAddress'), '-> stmt', by.get(S[0].get('PushingAddress')))
for a in anchors:
    print(a, '->', by.get(a))
