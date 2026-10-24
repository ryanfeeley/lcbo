import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
function setup(fetch){
 const elements=new Map();
 class Element{
  constructor(){this.value='';this.dataset={};this.hidden=false;this.textContent='';this._html='';}
  set innerHTML(value){this._html=value;for(const match of value.matchAll(/id="([^"]+)"/g))elements.set(match[1],new Element());}
  get innerHTML(){return this._html;}
  setAttribute(name,value){this[name]=value;}
 }
 for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],new Element());
 elements.get('radius').value='5';
 const context=vm.createContext({document:{getElementById:id=>elements.get(id),addEventListener(){},querySelectorAll(){return[]},documentElement:{dataset:{}}},window:{LCBO_API_BASE:''},localStorage:{getItem(){return null},setItem(){}},navigator:{},fetch,Response,AbortSignal,URLSearchParams,Intl,Map,setTimeout});
 vm.runInContext(source,context);
 return {context,elements};
}
const product={sku:'316570',name:'Oyster Bay Sauvignon Blanc',priceInCents:1795};
const inventory={product:{...product,inventories:{edges:[{node:{quantity:12,distanceKm:0.7,updatedAt:'2026-10-24T12:00:00Z',store:{name:'Yonge & Bloor',address:'2 Bloor St W',city:'Toronto',externalId:'1'}}}],totalCount:1,pageInfo:{hasNextPage:false}}}};
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('search automatically loads stock inline with no Check stock button',async()=>{
 const calls=[];const {context,elements}=setup(async url=>{calls.push(url);return Response.json(url.startsWith('/api/products')?{products:[product],totalCount:1,pageInfo:{hasNextPage:false}}:inventory);});
 await vm.runInContext("searchProducts('Oyster Bay')",context);await settled();
 assert.equal(calls.filter(url=>url.startsWith('/api/inventory')).length,1);
 assert.match(calls[1],/limit=3/);
 assert.doesNotMatch(elements.get('results').innerHTML,/Check stock|data-product=/);
 assert.match(elements.get('stock-summary-316570').innerHTML,/12/);
 assert.match(elements.get('stock-detail-316570').innerHTML,/Yonge &amp; Bloor/);
});
test('an inventory failure keeps the matching product visible and reports a per-product error',async()=>{
 const {context,elements}=setup(async url=>Response.json(url.startsWith('/api/products')?{products:[product],totalCount:1,pageInfo:{hasNextPage:false}}:{error:'LCBO.dev is temporarily unavailable.'},{status:url.startsWith('/api/products')?200:503}));
 await vm.runInContext("searchProducts('Oyster Bay')",context);await settled();
 assert.match(elements.get('results').innerHTML,/Oyster Bay Sauvignon Blanc/);
 assert.match(elements.get('stock-summary-316570').innerHTML,/Inventory unavailable/);
 assert.match(elements.get('stock-detail-316570').innerHTML,/Retry inventory/);
 assert.doesNotMatch(elements.get('results').innerHTML,/We couldn’t load the data/);
});
test('changing location refreshes inventory and ignores the old location response',async()=>{
 let resolveOld;let inventoryCalls=0;
 const {context,elements}=setup(async url=>{
  if(url.startsWith('/api/products'))return Response.json({products:[product],totalCount:1,pageInfo:{hasNextPage:false}});
  if(++inventoryCalls===1)return new Promise(resolve=>{resolveOld=resolve});
  assert.match(url,/lat=43.7/);const next=structuredClone(inventory);next.product.inventories.edges[0].node.quantity=25;return Response.json(next);
 });
 await vm.runInContext("searchProducts('Oyster Bay')",context);await settled();
 vm.runInContext("setLocation(43.7,-79.4,'new location')",context);await settled();
 resolveOld(Response.json(inventory));await settled();
 assert.match(elements.get('stock-summary-316570').innerHTML,/25/);
 assert.doesNotMatch(elements.get('stock-summary-316570').innerHTML,/>12</);
});
