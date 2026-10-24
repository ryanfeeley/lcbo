import {readFile,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const [html,js,server]=await Promise.all(['src/index.html','src/app.js','worker/server.js'].map(f=>readFile(new URL(f,root),'utf8')));
const output=server+`\nconst HTML=${JSON.stringify(html)};\nconst JS=${JSON.stringify(js)};\nexport default {async fetch(request){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return handlePublicAPI(request);if(path==='/config.js')return new Response("window.LCBO_API_BASE='';",{headers:{'Content-Type':'text/javascript; charset=utf-8'}});if(path==='/app.js')return new Response(JS,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});if(path!=='/')return new Response('Not found',{status:404});return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});}};\n`;
await writeFile(new URL('worker/index.js',root),output);
await rm(new URL('dist/',root),{recursive:true,force:true});
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),output);await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));console.log('Built Worker artifact');
