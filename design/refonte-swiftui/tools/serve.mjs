import {createServer} from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=await realpath(fileURLToPath(new URL('../dist',import.meta.url))).catch(()=>{throw new Error('Exécutez d’abord node tools/build.mjs');});
const port=Number(process.env.PORT??4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Port invalide');
const types={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.css':'text/css; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8'};
createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405);return res.end();}
  const pathname=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);
  const absolute=await realpath(path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname)));
  if(absolute!==root&&!absolute.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  const info=await stat(absolute);if(!info.isFile())throw new Error('not a file');
  res.writeHead(200,{'Content-Type':types[path.extname(absolute)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin'});
  if(req.method==='HEAD')return res.end();res.end(await readFile(absolute));
 }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Introuvable');}
}).listen(port,'127.0.0.1',()=>console.log(`Design Studio : http://127.0.0.1:${port}`));
