import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../worker/server.js';
const original=globalThis.fetch;
afterEach(()=>globalThis.fetch=original);
const request=path=>new Request('https://example.com'+path);
test('exact SKU uses product lookup and returns no fabricated matches',async()=>{globalThis.fetch=async(_url,options)=>{const payload=JSON.parse(options.body);assert.equal(payload.variables.sku,'12345');assert.match(payload.query,/product\(sku:\$sku\)/);return Response.json({data:{product:null}});};const r=await handleAPI(request('/api/products?q=12345'));assert.equal(r.status,200);assert.deepEqual((await r.json()).products,[]);});
test('location, minimum stock, sort and cursor reach inventory query',async()=>{globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);assert.deepEqual(p.variables,{sku:'12345',lat:43.6,lon:-79.4,radius:10,min:2,after:'next'});assert.match(p.query,/sortBy:QUANTITY,sortDirection:DESC/);return Response.json({data:{product:{sku:'12345',inventories:{edges:[],totalCount:0,pageInfo:{hasNextPage:false}}}}});};const r=await handleAPI(request('/api/inventory?sku=12345&lat=43.6&lon=-79.4&radius=10&min=2&sort=quantity&cursor=next'));assert.equal(r.status,200);});
test('upstream GraphQL errors become retryable errors, not zero stock',async()=>{globalThis.fetch=async()=>Response.json({data:null,errors:[{message:'Unexpected error.'}]});const r=await handleAPI(request('/api/products?q=wine'));assert.equal(r.status,503);assert.match((await r.json()).error,/LCBO.dev/);});
test('invalid coordinates do not call upstream',async()=>{globalThis.fetch=async()=>{assert.fail('must not fetch');};const r=await handleAPI(request('/api/inventory?sku=123&lat=999&lon=-79&radius=5&min=1'));assert.equal(r.status,503);});
test('address results only include Ontario locations',async()=>{globalThis.fetch=async()=>Response.json([{lat:'43.6',lon:'-79.4',display_name:'Toronto',address:{state:'Ontario'}},{lat:'40',lon:'-73',display_name:'Other',address:{state:'Other'}}]);const r=await handleAPI(request('/api/address?q=Toronto'));assert.equal((await r.json()).length,1);});

test('GitHub Pages origin can read the API; unrelated origins cannot',async()=>{
 const {handlePublicAPI}=await import('../worker/server.js');
 globalThis.fetch=async()=>Response.json({data:{product:null}});
 const allowed=await handlePublicAPI(new Request('https://api.example/api/products?q=123',{headers:{Origin:'https://ryanfeeley.github.io'}}));
 assert.equal(allowed.status,200);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://ryanfeeley.github.io');
 const blocked=await handlePublicAPI(new Request('https://api.example/api/products?q=123',{headers:{Origin:'https://unrelated.example'}}));
 assert.equal(blocked.status,403);assert.equal(blocked.headers.get('Access-Control-Allow-Origin'),null);
 const options=await handlePublicAPI(new Request('https://api.example/api/products',{method:'OPTIONS',headers:{Origin:'https://ryanfeeley.github.io'}}));
 assert.equal(options.status,204);
});

test('geocoding works when the host forbids access to the default cache',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'caches');
 Object.defineProperty(globalThis,'caches',{configurable:true,get(){throw Error('This Worker is not permitted to access the default cache.');}});
 globalThis.fetch=async()=>Response.json([{lat:'43.65',lon:'-79.38',display_name:'100 Queen St W, Toronto',address:{state:'Ontario'}}]);
 try{const r=await handleAPI(request('/api/address?q=100+Queen+St+W'));assert.equal(r.status,200);assert.equal((await r.json())[0].lat,'43.65');}
 finally{if(prior)Object.defineProperty(globalThis,'caches',prior);else delete globalThis.caches;}
});

test('intersection search normalizes and and returns Ontario intersection coordinates',async()=>{
 globalThis.fetch=async url=>{const u=new URL(url);assert.equal(u.hostname,'geocode.arcgis.com');assert.match(u.searchParams.get('SingleLine'),/Yonge & Bloor/);return Response.json({candidates:[{score:99,address:'Yonge St & Bloor St, Toronto',location:{x:-79.38675,y:43.67023},attributes:{Region:'Ontario'}}]});};
 const r=await handleAPI(request('/api/address?q=Yonge+and+Bloor,+Toronto'));assert.equal(r.status,200);assert.equal((await r.json())[0].lat,'43.67023');
});

test('product lookup recovers from a transient upstream GraphQL failure',async()=>{
 let calls=0;globalThis.fetch=async()=>++calls===1?Response.json({errors:[{message:'Unexpected error'}],data:null}):Response.json({data:{product:{sku:'316570',name:'Oyster Bay Sauvignon Blanc'}}});
 const r=await handleAPI(request('/api/products?q=316570'));assert.equal(r.status,200);assert.equal((await r.json()).products[0].name,'Oyster Bay Sauvignon Blanc');assert.equal(calls,2);
});
