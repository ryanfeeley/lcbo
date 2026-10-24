const PRODUCT_FIELDS = 'sku name priceInCents thumbnailUrl unitVolumeMl sellingPackage primaryCategory';
const PAGE = 'pageInfo {hasNextPage endCursor} totalCount';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
async function graphql(query,variables){
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch('https://api.lcbo.dev/graphql',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(6500)});
      if(response.status===429)throw Object.assign(Error('LCBO.dev is receiving too many requests. Wait a minute and try again.'),{noRetry:true});
      if(!response.ok)throw Error('LCBO.dev is temporarily unavailable. Please try again shortly.');
      const payload=await response.json();
      if(payload.errors?.length||!payload.data)throw Error('LCBO.dev could not complete this lookup. Its service may be temporarily unavailable. Please try again shortly.');
      return payload.data;
    }catch(error){lastError=error;if(error.noRetry)throw error;}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
  }
  if(lastError?.name==='TimeoutError'||lastError?.name==='AbortError')throw Error('LCBO.dev did not respond. Please try again shortly.');
  throw lastError;
}

// This hosting runtime does not permit Cloudflare caches.default. Cache only
// a bounded set of geocoding results in this isolate; cache access is optional.
const addressCache=new Map();
async function arcgisAddress(q){
  const geo=new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates');
  const query=q.replace(/\s+(?:and|at)\s+/gi,' & ');
  geo.search=new URLSearchParams({SingleLine:query+', Ontario, Canada',f:'json',outFields:'Match_addr,Addr_type,Region',maxLocations:'5',sourceCountry:'CAN',outSR:'4326'});
  const r=await fetch(geo,{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Address search is temporarily unavailable. Use your location or try again shortly.');
  const data=await r.json();if(data.error)throw Error('Address search is temporarily unavailable. Use your location or try again shortly.');
  return (data.candidates||[]).filter(x=>x.score>=85&&x.attributes?.Region==='Ontario'&&Number.isFinite(x.location?.x)&&Number.isFinite(x.location?.y)).map(x=>({lat:String(x.location.y),lon:String(x.location.x),display_name:x.address,source:'Esri'}));
}
async function lookupAddress(q){
  const key=q.toLocaleLowerCase();const cached=addressCache.get(key);
  if(cached&&cached.expires>Date.now())return cached.results;
  let results;
  if(/\s(?:and|at|&)\s/i.test(q))results=await arcgisAddress(q);
  else{
    try{
      const geo=new URL('https://nominatim.openstreetmap.org/search');
      geo.search=new URLSearchParams({q:q+', Ontario, Canada',format:'jsonv2',limit:'5',countrycodes:'ca',addressdetails:'1'});
      const response=await fetch(geo,{headers:{'User-Agent':'OntarioInventoryFinder/1.0 (https://ryanfeeley.github.io/lcbo/)','Accept':'application/json'},signal:AbortSignal.timeout(9000)});
      if(!response.ok)throw Error('Address search unavailable');
      const data=await response.json();
      results=data.filter(x=>x.address?.state==='Ontario'||x.address?.['ISO3166-2-lvl4']==='CA-ON').map(x=>({lat:x.lat,lon:x.lon,display_name:x.display_name,source:'OpenStreetMap'}));
    }catch{results=[];}
    if(!results.length)results=await arcgisAddress(q);
  }
  if(addressCache.size>=100)addressCache.delete(addressCache.keys().next().value);
  addressCache.set(key,{expires:Date.now()+15*60*1000,results});
  return results;
}

function number(params,key,min,max){const value=Number(params.get(key));if(!params.has(key)||!Number.isFinite(value)||value<min||value>max)throw Error('Please choose a valid location and search range.');return value;}
export async function handleAPI(request){const url=new URL(request.url),p=url.searchParams;if(request.method!=='GET')return json({error:'Method not allowed'},405);try{if(url.pathname==='/api/products'){const q=(p.get('q')||'').trim().slice(0,150),cursor=(p.get('cursor')||'').slice(0,500)||null;if(!q)return json({error:'Enter a product name or SKU.'},400);if(/^\d+$/.test(q)){const d=await graphql(`query($sku:String!){product(sku:$sku){${PRODUCT_FIELDS}}}`,{sku:q});return json({products:d.product?[d.product]:[],totalCount:d.product?1:0,pageInfo:{hasNextPage:false}});}const d=await graphql(`query($search:String!,$after:String){products(filters:{search:$search},pagination:{first:20,after:$after}){edges{node{${PRODUCT_FIELDS}}} ${PAGE}}}`,{search:q,after:cursor});return json({products:d.products.edges.map(e=>e.node),totalCount:d.products.totalCount,pageInfo:d.products.pageInfo});}
if(url.pathname==='/api/inventory'){const sku=p.get('sku');if(!sku||!/^\d{1,20}$/.test(sku))return json({error:'Invalid SKU.'},400);const lat=number(p,'lat',-90,90),lon=number(p,'lon',-180,180),radius=number(p,'radius',1,100),min=number(p,'min',0,100000);const sort=p.get('sort')==='quantity'?'QUANTITY':'DISTANCE',direction=sort==='QUANTITY'?'DESC':'ASC';const d=await graphql(`query($sku:String!,$lat:Float!,$lon:Float!,$radius:Float!,$min:Int!,$after:String){product(sku:$sku){${PRODUCT_FIELDS} inventories(filters:{latitude:$lat,longitude:$lon,radiusKm:$radius,minQuantity:$min},sortBy:${sort},sortDirection:${direction},pagination:{first:50,after:$after}){edges{node{quantity updatedAt distanceKm store{externalId name address city latitude longitude hasSameDayPickup}}} ${PAGE}}}}`,{sku,lat,lon,radius,min:Math.floor(min),after:(p.get('cursor')||'').slice(0,500)||null});return json(d);}
if(url.pathname==='/api/address'){const q=(p.get('q')||'').trim().slice(0,200);if(q.length<2)return json({error:'Enter a street address, intersection, or postal code.'},400);return json(await lookupAddress(q));}return json({error:'Not found'},404);}catch(error){return json({error:error.message||'The lookup is temporarily unavailable.'},503);}}

const PAGES_ORIGIN='https://ryanfeeley.github.io';
export async function handlePublicAPI(request){
  const origin=request.headers.get('Origin');
  const sameOrigin=origin===new URL(request.url).origin;
  if(origin&&origin!==PAGES_ORIGIN&&!sameOrigin)return json({error:'This origin is not supported.'},403);
  const headers=new Headers({'Vary':'Origin'});
  if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Methods','GET, OPTIONS');headers.set('Access-Control-Max-Age','86400');}
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const response=await handleAPI(request);
  const result=new Response(response.body,{status:response.status,headers:response.headers});
  headers.forEach((value,key)=>result.headers.set(key,value));
  return result;
}
