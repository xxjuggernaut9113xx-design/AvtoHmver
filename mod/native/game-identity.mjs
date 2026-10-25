import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const GAME_HASHES=Object.freeze({
 'CockHero/Binaries/Win64/CockHero.exe':'c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f',
 'CockHero/Content/Paks/CockHero-Windows.pak':'9d5d91de4466b6d6d2b975fb23a5b171de16dada87f436402fe755be16cf7fb6',
 'CockHero/Content/Paks/CockHero-Windows.utoc':'24dcef961f15d8ca29f8f746fb3ad5e518481164f9c8e401fc2ff1c99d9be462',
 'CockHero/Content/Paks/CockHero-Windows.ucas':'3bda22b91269d9ef835ff8b3b83d49fc67065c455357db49ee3917513e524ee6'
});
export async function verifyGameIdentity(root,{signal}={}){
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('An absolute exact-build game root is required.');
 signal?.throwIfAborted();
 for(const [relative,expected]of Object.entries(GAME_HASHES)){
  const file=path.join(root,relative);let cursor=path.dirname(file);
  for(;;){const stat=await fs.lstat(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Game identity paths cannot contain links.');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink())throw Error('Game identity requires regular files.');
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{
   const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)throw Error('Game identity file changed while opening.');
   const buffer=Buffer.alloc(1024*1024),hash=createHash('sha256');let size=0;
   for(;;){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;hash.update(buffer.subarray(0,bytesRead));}
   const after=await handle.stat();if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||hash.digest('hex')!==expected)throw Error('Native companion requires the exact verified v0.04 Exclusive build: '+relative);
  }finally{await handle.close();}
 }
 return 'v004-exclusive-c645757d';
}
