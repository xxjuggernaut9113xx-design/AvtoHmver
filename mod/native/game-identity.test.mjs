import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GAME_HASHES,NATIVE_BUILD_CONFIGS,nativeBuildConfig,verifyGameIdentity} from './game-identity.mjs';
test('production companion uses exactly the registered original build fingerprints',async()=>{
 const registry=JSON.parse(await fs.readFile(new URL('../compatibility.json',import.meta.url),'utf8'));
 assert.deepEqual(GAME_HASHES,registry.candidates.find(build=>build.id==='v004-exclusive-c645757d').files);
});
test('unknown executable is rejected without modifying files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-build-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'CockHero/Binaries/Win64');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'CockHero.exe');await fs.writeFile(file,'unsupported synthetic executable');
 await assert.rejects(verifyGameIdentity(root),/exact verified/);assert.equal(await fs.readFile(file,'utf8'),'unsupported synthetic executable');
});
test('explicit candidate configurations pin both builds and distinct native receipt roots',async()=>{
 const registry=JSON.parse(await fs.readFile(new URL('../compatibility.json',import.meta.url),'utf8'));
 for(const [id,build]of Object.entries(NATIVE_BUILD_CONFIGS))assert.deepEqual(build.hashes,registry.candidates.find(candidate=>candidate.id===id).files);
 assert.equal(nativeBuildConfig().packDirectory,'CockHero/Binaries/Win64/packs');
 assert.equal(nativeBuildConfig('v0051-hotfix-public-a8f46896').packDirectory,'CockHero/packs');
 for(const id of ['unknown','__proto__','constructor',null])assert.throws(()=>nativeBuildConfig(id),/exact native build/);
});
test('explicit v005 verification rejects a mismatched executable without modifying it',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-v005-build-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'CockHero/Binaries/Win64');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'CockHero.exe');await fs.writeFile(file,'unsupported synthetic executable');
 await assert.rejects(verifyGameIdentity(root,{buildId:'v0051-hotfix-public-a8f46896'}),/exact verified v0.05.1 Hotfix Public/);
 assert.equal(await fs.readFile(file,'utf8'),'unsupported synthetic executable');
});
