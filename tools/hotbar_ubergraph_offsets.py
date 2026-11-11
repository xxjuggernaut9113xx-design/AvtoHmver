"""Compute statement byte offsets for a retained function-AST JSON (reJOIce `functions/**/ExecuteUbergraph_*.json`).

Usage: python tools/hotbar_ubergraph_offsets.py <ExecuteUbergraph AST json>
Writes hotbar-offset-map.json (rows: index, offset, size, op). Sizes use the in-memory
script layout: pointers 8 bytes, FName 12 bytes, EX_Context = opcode + object + 4 + 8 + context
(no property-type byte), function calls add one EX_EndFunctionParms byte. Self-check: every
EX_Jump/EX_JumpIfNot/EX_PushExecutionFlow target must land on a statement start and every
EX_Context `Offset` must equal the computed size of its context expression. For the 2026-10-17
ModularInventoryHotbar_Widget ubergraph: 260 statements, 9725 bytes, 54/54 targets aligned,
0 context-offset mismatches. This validation is internal consistency, not a comparison with
the original engine's serialized offsets.
"""
import json,sys
src=sys.argv[1]
d=json.load(open(src,encoding='utf-8'))
S=d['statements']
bad=[]
def sz(x):
    o=x['op']
    if o in('EX_LocalVariable','EX_InstanceVariable','EX_DefaultVariable','EX_LocalOutVariable'):return 9
    if o in('EX_IntConst','EX_FloatConst','EX_SkipOffsetConst'):return 5
    if o=='EX_DoubleConst':return 9
    if o=='EX_ByteConst':return 2
    if o in('EX_True','EX_False','EX_Self','EX_Nothing','EX_NoObject','EX_EndOfScript','EX_PopExecutionFlow'):return 1
    if o=='EX_NameConst':return 13
    if o=='EX_ObjectConst':return 9
    if o=='EX_StringConst':return 2+len(x['Value'].encode('ascii'))
    if o=='EX_Let':return 1+8+sz(x['Variable'])+sz(x['Expression'])
    if o in('EX_LetBool','EX_LetObj'):return 1+sz(x['VariableExpression'])+sz(x['AssignmentExpression'])
    if o=='EX_Jump':return 5
    if o=='EX_JumpIfNot':return 5+sz(x['BooleanExpression'])
    if o=='EX_PushExecutionFlow':return 5
    if o=='EX_PopExecutionFlowIfNot':return 1+sz(x['BooleanExpression'])
    if o=='EX_ComputedJump':return 1+sz(x['CodeOffsetExpression'])
    if o=='EX_Return':return 1+sz(x['ReturnExpression'])
    if o in('EX_FinalFunction','EX_LocalFinalFunction','EX_CallMath'):return 1+8+sum(sz(p) for p in x['Parameters'])+1
    if o in('EX_LocalVirtualFunction','EX_VirtualFunction'):return 1+12+sum(sz(p) for p in x['Parameters'])+1
    if o=='EX_Context':
        c=sz(x['ContextExpression'])
        if c!=x['Offset']:bad.append(('ctxoffset',x['Offset'],c))
        return 1+sz(x['ObjectExpression'])+4+8+c
    if o=='EX_StructMemberContext':return 1+8+sz(x['StructExpression'])
    if o=='EX_DynamicCast':return 1+8+sz(x['Target'])
    if o=='EX_PrimitiveCast':return 1+1+sz(x['Target'])
    if o=='EX_StructConst':return 1+8+4+sum(sz(v) for v in x['Value'])+1
    raise Exception(o)
rows=[];off=0
for i,s in enumerate(S):
    n=sz(s);rows.append((i,off,n,s['op']));off+=n
by={r[1]:r[0] for r in rows}
print('statements',len(S),'size',off,'ctx-offset mismatches',len(bad),bad[:5])
miss=[]
for (i,o,n,op),s in zip(rows,S):
    t=s.get('CodeOffset') if op in('EX_Jump','EX_JumpIfNot') else s.get('PushingAddress') if op=='EX_PushExecutionFlow' else None
    if t is not None and t not in by:miss.append((i,t))
print('unaligned targets',len(miss),miss[:10])
json.dump({'rows':[{'index':i,'offset':o,'size':n,'op':op} for i,o,n,op in rows]},open('hotbar-offset-map.json','w'))
for t in (9717,9722):print(t,'->',by.get(t))
