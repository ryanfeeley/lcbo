'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={inventoryGeneration:0,stocks:new Map(),lat:43.6532,lon:-79.3832,label:'downtown Toronto',product:null,products:[],inventory:[],cursor:null,total:0,min:1,sort:'distance',store:'',request:0,productCursor:null,search:''};
let saved=[];try{saved=JSON.parse(localStorage.getItem('lcbo-saved')||'[]');if(!Array.isArray(saved))saved=[];saved=saved.filter(x=>x&&typeof x.sku==='string'&&typeof x.name==='string').slice(0,30);}catch{}
function saveList(){try{localStorage.setItem('lcbo-saved',JSON.stringify(saved));}catch{}renderSaved();}
function renderSaved(){$('saved').innerHTML=saved.length?saved.map(p=>`<div class="saved-item"><button data-saved="${esc(p.sku)}">${esc(p.name)}<small>SKU ${esc(p.sku)}</small></button><button class="remove" data-remove="${esc(p.sku)}" aria-label="Remove ${esc(p.name)}">×</button></div>`).join(''):'<div class="saved-empty">Tap ☆ on a product to save it here.<br>Saved on this browser.</div>';}
function isSaved(){return saved.some(p=>p.sku===state.product?.sku);}
function money(n){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n/100);}
function details(p){return [p.primaryCategory?.split('|').pop(),p.sellingPackage||(p.unitVolumeMl?`${p.unitVolumeMl} mL`:null),`SKU ${p.sku}`].filter(Boolean).map(esc).join(' · ');}
function image(p){return p.thumbnailUrl&&/^https:\/\//.test(p.thumbnailUrl)?`<img class="product-img" src="${esc(p.thumbnailUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<span class="product-img" aria-hidden="true" style="display:grid;place-items:center;font-size:24px;color:#b19ba3">♧</span>';}
async function api(path,params){const r=await fetch((window.LCBO_API_BASE||'')+path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(25000)});let data;try{data=await r.json();}catch{throw Error('The service returned an unreadable response. Please try again.');}if(!r.ok||data.error)throw Error(data.error||'Unable to complete this search. Please try again.');return data;}
function loading(text){$('status').textContent='Searching…';$('results').setAttribute('aria-busy','true');$('results').innerHTML=`<div class="loading"><span class="spinner" aria-hidden="true"></span>${esc(text)}</div>`;}
function finished(){$('results').setAttribute('aria-busy','false');}
function showError(error,action){finished();$('status').textContent='Service unavailable';$('results').innerHTML=`<div class="empty"><div class="empty-icon" aria-hidden="true">!</div><h3>We couldn’t load the data</h3><p>${esc(error.message||'The request timed out. Please try again.')}</p><button class="secondary" id="retry">Try again</button></div>`;$('retry').onclick=action;}
async function searchProducts(q,more=false){
 q=q.trim();if(!q)return;const id=++state.request;state.inventoryGeneration++;state.search=q;state.product=null;
 if(!more)state.stocks.clear();
 $('query').value=q;$('results-title').textContent='Nearby inventory';$('results-sub').textContent=`Searching for “${q}”`;$('search-button').disabled=true;loading('Looking up products…');
 try{const d=await api('/api/products',{q,cursor:more?state.productCursor||'':''});if(id!==state.request)return;
 state.products=more?state.products.concat(d.products):d.products;state.productCursor=d.pageInfo?.hasNextPage?d.pageInfo.endCursor:null;state.productTotal=d.totalCount??state.products.length;renderProducts();refreshInventory(false);
 }catch(e){if(id===state.request)showError(e,()=>searchProducts(q));}finally{if(id===state.request)$('search-button').disabled=false;}
}
function renderProducts(){
 finished();$('search-button').disabled=false;$('status').textContent=state.products.length?'Loading inventory…':'No matches';
 $('results-sub').textContent=`${state.productTotal} product${state.productTotal===1?'':'s'} · within ${$('radius').value} km of ${state.label}`;
 $('stock-filters').hidden=!state.products.length;
 if(!state.products.length){$('results').innerHTML='<div class="empty"><h3>No products returned</h3><p>LCBO.dev returned no products for this search. Try a shorter brand name or an exact SKU. Its catalogue may be incomplete.</p></div>';return;}
 $('results').innerHTML=state.products.map(p=>`<article class="product-card"><div class="product-row">${image(p)}<div class="product-info"><h3>${esc(p.name)}</h3><p>${details(p)}</p><span class="product-price">${money(p.priceInCents)}</span></div><div class="product-stock" id="stock-summary-${esc(p.sku)}"><span class="spinner" aria-hidden="true"></span>Loading stock…</div><button class="save-product" data-save="${esc(p.sku)}" aria-label="${saved.some(x=>x.sku===p.sku)?'Unsave':'Save'} ${esc(p.name)}">${saved.some(x=>x.sku===p.sku)?'★':'☆'}</button></div><div class="inline-inventory" id="stock-detail-${esc(p.sku)}" aria-live="polite"></div></article>`).join('')+(state.productCursor?'<button class="secondary load-more" id="more-products">Load more products</button>':'');
 for(const p of state.products)renderStock(p.sku);
}
function renderStock(sku){
 const summary=$('stock-summary-'+sku),detail=$('stock-detail-'+sku);if(!summary||!detail)return;
 const stock=state.stocks.get(sku);
 if(!stock||stock.loading&&!stock.rows?.length){summary.innerHTML='<span class="spinner" aria-hidden="true"></span>Loading stock…';detail.innerHTML='<p class="stock-note">Looking up nearby store quantities…</p>';return;}
 if(stock.error&&!stock.rows?.length){summary.innerHTML='<span class="stock-unavailable">Inventory unavailable</span>';detail.innerHTML=`<p class="stock-note stock-error">${esc(stock.error)} <button class="text-button" data-retry-stock="${esc(sku)}">Retry inventory</button></p>`;return;}
 const rows=stock.rows||[];
 if(!rows.length){summary.innerHTML='<span class="stock-unavailable">No reported stock</span>';detail.innerHTML='<p class="stock-note">No matching inventory records within this distance. Try a larger radius or lower the minimum quantity. Missing records do not confirm zero stock.</p>';return;}
 const nearest=rows[0];summary.innerHTML=`<span class="quantity">${esc(nearest.quantity)}</span><span>${state.sort==='quantity'?'at best-stocked store':'at nearest store'}</span>`;
 detail.innerHTML=`<div class="inline-store-list">${rows.map(x=>{const st=x.store;const destination=st.latitude!=null&&st.longitude!=null?`${st.latitude},${st.longitude}`:[st.address,st.city,'Ontario'].filter(Boolean).join(', ');const date=x.updatedAt?new Date(x.updatedAt):null;const updated=date&&!isNaN(date)?date.toLocaleDateString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric'}):null;
 return `<div class="inline-store"><div><a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}" target="_blank" rel="noopener">${esc(st.name)} ↗</a><p>${esc([st.address,st.city].filter(Boolean).join(', '))}</p><p>${x.distanceKm!=null?Number(x.distanceKm).toFixed(1)+' km away · ':''}Store #${esc(st.externalId)}${updated?' · Reported '+esc(updated):''}</p></div><div class="inline-quantity ${x.quantity>0?'':'zero'}"><strong>${esc(x.quantity)}</strong><span>${x.quantity>0?'in stock':'out of stock'}</span></div></div>`;}).join('')}</div><div class="stock-footer"><span>Showing ${rows.length} of ${stock.total} matching stores</span>${stock.cursor?`<button class="text-button" data-more-stock="${esc(sku)}" ${stock.loading?'disabled':''}>${stock.loading?'Loading…':'More stores'}</button>`:''}${stock.error?`<span class="stock-error">${esc(stock.error)} <button class="text-button" data-retry-stock="${esc(sku)}">Retry</button></span>`:''}</div>`;
}
async function loadStock(sku,generation,more=false){
 const prior=state.stocks.get(sku);
 state.stocks.set(sku,{...prior,loading:true,error:null});renderStock(sku);
 try{const d=await api('/api/inventory',{sku,lat:state.lat,lon:state.lon,radius:$('radius').value,min:state.min,sort:state.sort,limit:3,cursor:more?prior?.cursor||'':''});
 if(generation!==state.inventoryGeneration)return;
 if(!d.product)throw Error('LCBO.dev no longer has this product.');
 const inv=d.product.inventories;
 state.stocks.set(sku,{loading:false,rows:more?[...(prior?.rows||[]),...inv.edges.map(e=>e.node)]:inv.edges.map(e=>e.node),total:inv.totalCount,cursor:inv.pageInfo.hasNextPage?inv.pageInfo.endCursor:null});
 }catch(e){if(generation!==state.inventoryGeneration)return;state.stocks.set(sku,{...prior,loading:false,error:e.message||'Inventory lookup timed out. Please retry.'});}
 if(generation===state.inventoryGeneration){renderStock(sku);updateStockStatus();}
}
function updateStockStatus(){const values=state.products.map(p=>state.stocks.get(p.sku));const pending=values.filter(x=>!x||x.loading).length;const failed=values.filter(x=>x?.error).length;$('status').textContent=pending?`Loading stock (${values.length-pending}/${values.length})`:failed?`${failed} inventory lookup${failed===1?'':'s'} unavailable`:'Inventory loaded';}
async function refreshInventory(reset=true){
 const generation=++state.inventoryGeneration;if(reset)state.stocks.clear();
 if(!state.products.length)return;
 $('results-sub').textContent=`${state.productTotal} product${state.productTotal===1?'':'s'} · within ${$('radius').value} km of ${state.label}`;
 const queue=state.products.filter(p=>!state.stocks.has(p.sku)||state.stocks.get(p.sku).loading).map(p=>p.sku);
 for(const sku of queue){state.stocks.delete(sku);renderStock(sku);}updateStockStatus();
 async function worker(){while(queue.length&&generation===state.inventoryGeneration){await loadStock(queue.shift(),generation);}}
 await Promise.all([worker(),worker()]);
}
function setLocation(lat,lon,label){state.lat=lat;state.lon=lon;state.label=label;$('location-label').textContent='Search area: '+label;$('loc-sub').textContent=label;$('location-error').hidden=true;$('addresses').innerHTML='';if(state.products.length)refreshInventory();}
function locationError(message){$('location-error').textContent=message;$('location-error').hidden=false;}
let addressRequest=0;
async function findAddress(){const q=$('address').value.trim();if(!q){locationError('Enter an Ontario address, intersection, or postal code first.');return;}const id=++addressRequest;$('find-address').disabled=true;$('addresses').innerHTML='<span class="hint">Looking up address…</span>';$('location-error').hidden=true;try{const d=await api('/api/address',{q});if(id!==addressRequest)return;if(!d.length){$('addresses').innerHTML='';locationError('No Ontario address found. Try a full street address, city, or postal code.');return;}$('addresses').innerHTML='<span class="hint">Choose an address to set your search location:</span>'+d.map((r,i)=>`<button class="address-option" data-address="${i}">${esc(r.display_name)}</button>`).join('');$('addresses').onclick=e=>{const b=e.target.closest('[data-address]');if(b){const r=d[+b.dataset.address];$('address').value=r.display_name;setLocation(+r.lat,+r.lon,r.display_name.split(',').slice(0,2).join(','));}};}catch(e){$('addresses').innerHTML='';locationError(e.message);}finally{$('find-address').disabled=false;}}
$('product-form').onsubmit=e=>{e.preventDefault();searchProducts($('query').value);};$('address-form').onsubmit=e=>{e.preventDefault();findAddress();};$('radius').onchange=()=>{if(state.products.length)refreshInventory();};$('nearby').onclick=()=>{if(!navigator.geolocation){locationError('Location is not supported in this browser. Search by address instead.');return;}$('nearby').disabled=true;$('nearby').textContent='Locating…';navigator.geolocation.getCurrentPosition(p=>{addressRequest++;$('address').value='';setLocation(p.coords.latitude,p.coords.longitude,'your current location');$('nearby').disabled=false;$('nearby').textContent='Use my location';},e=>{$('nearby').disabled=false;$('nearby').textContent='Use my location';locationError(e.code===1?'Location access was declined. Enter an address to search nearby.':'We couldn’t determine your location. Try an address instead.');},{enableHighAccuracy:false,timeout:12000,maximumAge:120000});};
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.search)searchProducts(b.dataset.search);
 if(b.dataset.saved)searchProducts(b.dataset.saved);
 if(b.dataset.remove){saved=saved.filter(x=>x.sku!==b.dataset.remove);saveList();refreshSaveButtons();}
 if(b.dataset.save){const p=state.products.find(x=>x.sku===b.dataset.save);if(!p)return;if(saved.some(x=>x.sku===p.sku))saved=saved.filter(x=>x.sku!==p.sku);else saved=[{sku:p.sku,name:p.name},...saved].slice(0,30);saveList();refreshSaveButtons();}
 if(b.dataset.retryStock)loadStock(b.dataset.retryStock,state.inventoryGeneration);
 if(b.dataset.moreStock)loadStock(b.dataset.moreStock,state.inventoryGeneration,true);
 if(b.id==='more-products')searchProducts(state.search,true);
});
function refreshSaveButtons(){for(const b of document.querySelectorAll('[data-save]')){const p=state.products.find(x=>x.sku===b.dataset.save);if(!p)continue;const active=saved.some(x=>x.sku===p.sku);b.textContent=active?'★':'☆';b.setAttribute('aria-label',`${active?'Unsave':'Save'} ${p.name}`);}}
$('in-stock').onchange=e=>{state.min=e.target.checked?1:0;$('min-quantity').value=state.min;refreshInventory();};
$('min-quantity').onchange=e=>{state.min=Math.max(0,Math.min(100000,Math.floor(Number(e.target.value)||0)));$('in-stock').checked=state.min>0;refreshInventory();};
$('sort').onchange=e=>{state.sort=e.target.value;refreshInventory();};

renderSaved();

function setLocationMode(mode){const current=mode==='current';$('mode-current').setAttribute('aria-pressed',String(current));$('mode-address').setAttribute('aria-pressed',String(!current));$('currentLocationPanel').hidden=!current;$('addressLocationPanel').hidden=current;}
$('mode-current').onclick=()=>setLocationMode('current');
$('mode-address').onclick=()=>setLocationMode('address');
try{$('theme').value=localStorage.getItem('lcbo-theme')||'system';}catch{}
$('theme').onchange=e=>{const theme=e.target.value;if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;try{localStorage.setItem('lcbo-theme',theme);}catch{}};
