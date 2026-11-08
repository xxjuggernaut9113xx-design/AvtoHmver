const {test}=require('node:test');
const assert=require('node:assert/strict');
const chpack=require('../static/fanservice/chpack.js');

test('oversized input rejects before any archive bytes are read',async()=>{
 let read=false;
 await assert.rejects(chpack.unpack({size:chpack.limit+1,arrayBuffer:async()=>{read=true;throw Error('Must not read');}}),/up to 512 MiB/);
 assert.equal(read,false);
});

test('streaming export rejects the size limit before retaining the excessive chunk',async()=>{
 let cancelled=false;
 const media=[{id:'local:limit',local:true,file:'limit.png',type:'image',url:'blob:https://phone.example/limit'}];
 const fetchMedia=async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:false,value:{length:chpack.limit+1}}),cancel:async()=>{cancelled=true;}})}});
 await assert.rejects(chpack.create({name:'Synthetic size limit',unlock_cost:0},media,{origin:'https://phone.example',fetchMedia}),/exceeds 512 MiB/);
 assert.equal(cancelled,true);
});
