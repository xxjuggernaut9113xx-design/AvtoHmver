// Export the editable SVG branding directly to a Windows PNG-backed icon.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(process.env.FANSERVICE_PLAYWRIGHT_MODULE||'../tests/browser/node_modules/playwright');
(async()=>{
 const root=path.resolve(__dirname,'../static/fanservice/assets'),svg=fs.readFileSync(path.join(root,'app-icon-512.svg'),'utf8');
 const browser=await chromium.launch({headless:true,...(process.env.FANSERVICE_BROWSER_EXECUTABLE?{executablePath:process.env.FANSERVICE_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:256,height:256}});await page.setContent('<style>body{margin:0;background:transparent}</style>'+svg.replace('width="512" height="512"','width="256" height="256"'));
  const png=await page.screenshot({omitBackground:true}),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);const icon=Buffer.concat([header,png]);fs.writeFileSync(path.join(root,'fanservice.ico'),icon);
  if(process.argv[2]){const target=path.resolve(process.argv[2],'Build/Windows');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'Application.ico'),icon);}
  const manifestPath=path.join(root,'provenance.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));const record={file:'fanservice.ico',derived_from:'app-icon-512.svg',source:'packaging/generate-windows-icon.cjs',license:'GPL-3.0-only',sha256:crypto.createHash('sha256').update(icon).digest('hex')};const index=manifest.findIndex(entry=>entry.file===record.file);if(index<0)manifest.push(record);else manifest[index]=record;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
