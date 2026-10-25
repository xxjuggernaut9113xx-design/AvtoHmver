import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GAME_HASHES,verifyGameIdentity} from './game-identity.mjs';
test('production companion uses exactly the registered original build fingerprints',async()=>{
 const registry=JSON.parse(await fs.readFile(new URL('../compatibility.json',import.meta.url),'utf8'));
 assert.deepEqual(GAME_HASHES,registry.candidates.find(build=>build.id==='v004-exclusive-c645757d').files);
});
test('unknown executable is rejected without modifying files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-build-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'CockHero/Binaries/Win64');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'CockHero.exe');await fs.writeFile(file,'unsupported synthetic executable');
 await assert.rejects(verifyGameIdentity(root),/exact verified/);assert.equal(await fs.readFile(file,'utf8'),'unsupported synthetic executable');
});
