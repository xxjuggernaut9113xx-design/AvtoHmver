const {test}=require('node:test'),assert=require('node:assert/strict');
const map=require('../docs/fanservice/evidence/timer-current-bytecode-map-20261109.json');
test('compact Timer bytecode map is internally consistent',()=>{
 assert.equal(map.script_size,99921);assert.equal(map.statement_count,2570);assert.equal(map.targets.length,map.direct_target_count);
 const pairs=new Map();
 for(const t of map.targets){
  assert.ok(t.target_offset>=0&&t.target_offset<map.script_size);assert.ok(t.target_index>=0&&t.target_index<map.statement_count);
  const seen=pairs.get(t.target_offset);assert.ok(seen===undefined||seen===t.target_index,`offset ${t.target_offset} maps to two statements`);pairs.set(t.target_offset,t.target_index);
 }
 const sorted=[...pairs].sort((a,b)=>a[0]-b[0]);
 for(let i=1;i<sorted.length;i++)assert.ok(sorted[i][1]>sorted[i-1][1],'offsets and statement indices are monotone');
 assert.equal(pairs.get(92333),2330);assert.equal(pairs.get(56800),1367);
});
test('labelled Ubergraph entry offsets sit between their neighbouring recorded targets',()=>{
 const sorted=[...new Map(map.targets.map(t=>[t.target_offset,t.target_index]))].sort((a,b)=>a[0]-b[0]);
 assert.deepEqual(map.entry_offsets.entries.map(e=>[e.entry_offset,e.entry_index]),[[66033,1598],[73198,1776],[79488,1947]]);
 for(const {entry_offset:offset,entry_index:index} of map.entry_offsets.entries){
  const lower=sorted.filter(([o])=>o<offset).at(-1),upper=sorted.find(([o])=>o>offset);
  assert.ok(lower[1]<index&&index<upper[1],`entry ${offset}`);
 }
 assert.match(map.entry_offsets.source,/not recomputed/);
});
