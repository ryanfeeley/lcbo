import {mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const output=new URL('pages-dist/',root);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const name of ['index.html','app.js','config.js'])await copyFile(new URL('src/'+name,root),new URL(name,output));
await writeFile(new URL('.nojekyll',output),'');
console.log('Built GitHub Pages interface in pages-dist/');
