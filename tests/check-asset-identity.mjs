import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {normalizeAsset,canonicalSavedId,migrateWatchlist,migrateSavedRecords,migrateBrowserIdentity} from '../app/asset-identity.ts';
import {portfolioValue,crossing} from '../app/market-utils.ts';
const gecko=[{id:'bitcoin',name:'Bitcoin',symbol:'btc',current_price:100,market_cap_rank:1},{id:'ethereum',name:'Ethereum',symbol:'eth',current_price:20,market_cap_rank:2}];
const paprika=[{id:'btc-bitcoin',name:'Bitcoin',symbol:'BTC',rank:1,quotes:{USD:{price:101,market_cap:1000,percent_change_24h:1,volume_24h:100}}},{id:'eth-ethereum',name:'Ethereum',symbol:'ETH',rank:2,quotes:{USD:{price:21,market_cap:100,percent_change_24h:1,volume_24h:10}}},{id:'btc-other',name:'Unrelated Token',symbol:'BTC',rank:3,quotes:{USD:{price:999,market_cap:5,percent_change_24h:1,volume_24h:1}}}];
const holdings=[{id:'position1',coinId:'btc-bitcoin',units:2,cost:90,extra:'kept'},{id:'position2',coinId:'eth-ethereum',units:1,cost:10},{id:'position3',coinId:'unknown-asset',units:3,cost:4}];
const alerts=[{id:'alert1',coinId:'btc-bitcoin',target:100,direction:'above',triggeredAt:undefined}];
const migrated=migrateSavedRecords(holdings), migratedAlerts=migrateSavedRecords(alerts);
assert.equal(migrated[0].coinId,'bitcoin');assert.equal(migrated[0].extra,'kept');assert.equal(migrated[2].coinId,'unknown-asset');assert.equal(holdings[0].coinId,'btc-bitcoin');
assert.deepEqual(migrateWatchlist(['bitcoin','btc-bitcoin','eth-ethereum','unknown']),['bitcoin','ethereum','unknown']);
assert.equal(canonicalSavedId('other-btc'),'other-btc');
const unknown=normalizeAsset({id:'btc-other',name:'Unrelated Token',symbol:'BTC'},'CoinPaprika');
assert.equal(unknown.id,'paprika-btc-other');assert.equal(unknown.gecko_id,undefined);assert.equal(unknown.identity_verified,false);
assert.notEqual(normalizeAsset({id:'bitcoin',name:'Unrelated Token',symbol:'btc'},'CoinGecko').id,'bitcoin');
const stored=new Map([['cp-stars',JSON.stringify(['btc-bitcoin','unknown'])],['cp-holdings-v1',JSON.stringify(holdings)],['cp-alerts-v1',JSON.stringify(alerts)]]);
const storage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
const originals=new Map(stored);migrateBrowserIdentity(storage);
for(const [key,value] of originals)assert.equal(stored.get(key+'-before-identity-v1'),value);
const after=new Map(stored);migrateBrowserIdentity(storage);assert.deepEqual(stored,after);
assert.doesNotThrow(()=>migrateBrowserIdentity({getItem:()=>{throw Error('storage blocked')},setItem:()=>{throw Error('storage blocked')}}));
const broken=new Map([['cp-stars','invalid JSON']]);migrateBrowserIdentity({getItem:k=>broken.get(k)||null,setItem:(k,v)=>broken.set(k,v)});assert.equal(broken.get('cp-stars'),'invalid JSON');
// Real route handlers and mocked provider HTTP: independent module instances bypass
// the intentional five-minute cache to exercise CG -> fallback -> recovery.
const originalFetch=globalThis.fetch;const historyModule=new URL('../app/api/markets/route.mjs',import.meta.url);const historyCode=await readFile(historyModule,'utf8');
const cleanup=[];
try {
 for(const [i,provider] of ['CoinGecko','CoinPaprika','CoinGecko'].entries()){
  const calls=[];
  globalThis.fetch=async(input)=>{
   const url=String(input);calls.push(url);
   if(url.includes('/coins/markets?'))return provider==='CoinGecko'?Response.json(gecko):Response.json({error:'throttled'},{status:429});
   if(url==='https://api.coinpaprika.com/v1/tickers')return Response.json(paprika);
   if(url.includes('/coins/bitcoin/market_chart?'))return Response.json({prices:[[1000,100],[2000,101]],total_volumes:[[1000,1],[2000,2]]});
   if(url.includes('/coins/ethereum/market_chart?'))return Response.json({prices:[[1000,20],[2000,21]]});
   throw Error('Unexpected provider request: '+url);
  };
  const radar=await import('../app/api/radar/route.mjs?scenario='+i);
  // The history handler must import that same scenario's market snapshot cache.
  const path=new URL('./identity-case-'+i+'.mjs',historyModule);cleanup.push(path);
  await writeFile(path,historyCode.replace("'../radar/route.mjs'","'../radar/route.mjs?scenario="+i+"'"));
  const markets=await import(path.href);
  const response=await radar.GET(new Request('https://test.local/api/radar?mode=market'));
  assert.equal(response.status,200);const snapshot=await response.json();assert.equal(snapshot.provider,provider);
  assert.equal(snapshot.coins[0].id,'bitcoin');assert.equal(snapshot.coins[1].id,'ethereum');
  assert.equal(snapshot.coins[0].provider_id,provider==='CoinGecko'?'bitcoin':'btc-bitcoin');
  assert.equal(snapshot.coins[0].gecko_id,'bitcoin');assert.equal(snapshot.coins[0].identity_verified,true);
  assert.deepEqual(normalizeAsset(snapshot.coins[0]),snapshot.coins[0]);
  const values=portfolioValue(migrated,snapshot.coins);assert.equal(values[0].value,provider==='CoinGecko'?200:202);assert.equal(values[2].value,null);
  const asset=snapshot.coins.find(c=>c.id===migratedAlerts[0].coinId);assert.ok(crossing('above',100,asset.current_price));
  assert.equal(snapshot.coins.filter(c=>migrateWatchlist(['btc-bitcoin','eth-ethereum']).includes(c.id)).length,2);
  for(const id of ['bitcoin','ethereum']){
   const history=await markets.GET(new Request('https://test.local/api/markets?id='+id+'&days=7'));
   assert.equal(history.status,200);const data=await history.json();assert.equal(data.coinId,id);assert.equal(data.provider,'CoinGecko');assert.equal(data.points.length,2);
  }
  if(provider==='CoinPaprika'){
   assert.equal(snapshot.coins[2].id,'paprika-btc-other');assert.equal(values[0].value,202);
   const bad=await markets.GET(new Request('https://test.local/api/markets?id=paprika-btc-other&days=7'));
   assert.equal(bad.status,502);assert.match((await bad.json()).error,/verified cross-provider mapping/);
   assert.ok(!calls.some(u=>u.includes('/search?')||u.includes('coinbase')),'Unknown mapping must not guess a ticker/name history');
  }
 }
 // Native CoinGecko assets outside the registry retain their existing verified
 // Coinbase fallback; only unverified Paprika-to-other-provider guesses are gated.
 globalThis.fetch=async(input)=>{
  const url=String(input);
  if(url.includes('/coins/markets?'))return Response.json([{id:'ripple',name:'XRP',symbol:'xrp',market_cap_rank:4,current_price:2}]);
  if(url.includes('/coins/ripple/market_chart?'))return Response.json({error:'throttled'},{status:429});
  if(url==='https://api.exchange.coinbase.com/currencies/XRP')return Response.json({id:'XRP',name:'XRP'});
  if(url.includes('/products/XRP-USD/candles?')){const now=Math.floor(Date.now()/1000);return Response.json([[now-900,1,3,2,2,100],[now-600,1,3,2,2.1,100]])}
  throw Error('Unexpected native fallback request: '+url);
 };
 const nativePath=new URL('./identity-native.mjs',historyModule);cleanup.push(nativePath);
 await writeFile(nativePath,historyCode.replace("'../radar/route.mjs'","'../radar/route.mjs?scenario=native'"));
 const nativeMarkets=await import(nativePath.href);
 const native=await nativeMarkets.GET(new Request('https://test.local/api/markets?id=ripple&days=1'));
 assert.equal(native.status,200);const nativeData=await native.json();assert.equal(nativeData.provider,'Coinbase Exchange');assert.equal(nativeData.points.length,2);
}finally{globalThis.fetch=originalFetch;await Promise.all(cleanup.map(p=>unlink(p)))}
console.log('Provider transitions, verified chart IDs, duplicate tickers, identity guards, preserved migrations, missing mappings: passed.');
