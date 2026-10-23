import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const root=new URL('./',import.meta.url);mkdirSync(new URL('www',root),{recursive:true});cpSync(new URL('../static/fanservice/',root),new URL('www/',root),{recursive:true});
// Android loads bundled web assets and connects only to an explicitly entered Server.
const index=new URL('www/index.html',root);let html=readFileSync(index,'utf8');html=html.replace('</head>','<script src="capacitor.js"></script></head>');writeFileSync(index,html);
