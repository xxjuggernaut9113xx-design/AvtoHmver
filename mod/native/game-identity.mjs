import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const DEFAULT_NATIVE_BUILD='v004-exclusive-c645757d';
export const GAME_HASHES=Object.freeze({
 'CockHero/Binaries/Win64/CockHero.exe':'c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f',
 'CockHero/Content/Paks/CockHero-Windows.pak':'9d5d91de4466b6d6d2b975fb23a5b171de16dada87f436402fe755be16cf7fb6',
 'CockHero/Content/Paks/CockHero-Windows.utoc':'24dcef961f15d8ca29f8f746fb3ad5e518481164f9c8e401fc2ff1c99d9be462',
 'CockHero/Content/Paks/CockHero-Windows.ucas':'3bda22b91269d9ef835ff8b3b83d49fc67065c455357db49ee3917513e524ee6'
});
export const NATIVE_BUILD_CONFIGS=Object.freeze({
 [DEFAULT_NATIVE_BUILD]:Object.freeze({hashes:GAME_HASHES,packDirectory:'CockHero/Binaries/Win64/packs',label:'v0.04 Exclusive'}),
 'v0051-hotfix-public-a8f46896':Object.freeze({hashes:Object.freeze({
  'CockHero/Binaries/Win64/CockHero.exe':'a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10',
  'CockHero/Content/Paks/CockHero-Windows.pak':'345a25a2cc9f0c60682bf61b3580dd92c18a116b43e4c2a7426207802fd2fc38',
  'CockHero/Content/Paks/CockHero-Windows.utoc':'6b529fc3023c8e4d0a0781a8660a1c134da811a7e702f00693c872cbcb0eafef',
  'CockHero/Content/Paks/CockHero-Windows.ucas':'dade7767425e345cb3c6858f5a7b9888ac0f3e269ca7fc173fafdbac06dde6dc'
 }),packDirectory:'CockHero/packs',label:'v0.05.1 Hotfix Public'})
});
export function nativeBuildConfig(buildId=DEFAULT_NATIVE_BUILD){
 if(typeof buildId!=='string'||!Object.hasOwn(NATIVE_BUILD_CONFIGS,buildId))throw Error('Invalid exact native build identity.');
 return NATIVE_BUILD_CONFIGS[buildId];
}
export async function verifyGameIdentity(root,{signal,buildId=DEFAULT_NATIVE_BUILD}={}){
 const build=nativeBuildConfig(buildId);
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('An absolute exact-build game root is required.');
 signal?.throwIfAborted();
 for(const [relative,expected]of Object.entries(build.hashes)){
  const file=path.join(root,relative);let cursor=path.dirname(file);
  for(;;){const stat=await fs.lstat(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Game identity paths cannot contain links.');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink())throw Error('Game identity requires regular files.');
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{
   const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)throw Error('Game identity file changed while opening.');
   const buffer=Buffer.alloc(1024*1024),hash=createHash('sha256');let size=0;
   for(;;){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;hash.update(buffer.subarray(0,bytesRead));}
   const after=await handle.stat();if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||hash.digest('hex')!==expected)throw Error('Native companion requires the exact verified '+build.label+' build: '+relative);
  }finally{await handle.close();}
 }
 return buildId;
}
