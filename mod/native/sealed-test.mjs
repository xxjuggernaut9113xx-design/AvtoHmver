import {webcrypto} from 'node:crypto';
export async function sealConnection(exchange,connection){
 const subtle=webcrypto.subtle,pair=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const peer=await subtle.importKey('raw',Buffer.from(exchange.public_key,'base64'),{name:'ECDH',namedCurve:'P-256'},false,[]),bits=await subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256);
 const key=await subtle.importKey('raw',await subtle.digest('SHA-256',bits),'AES-GCM',false,['encrypt']),iv=webcrypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await subtle.encrypt({name:'AES-GCM',iv,additionalData:Buffer.from(exchange.handshake_token)},key,Buffer.from(JSON.stringify(connection)));
 return {handshake_token:exchange.handshake_token,public_key:Buffer.from(await subtle.exportKey('raw',pair.publicKey)).toString('base64'),iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};
}
