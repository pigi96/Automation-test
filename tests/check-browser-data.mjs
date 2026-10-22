import assert from 'node:assert/strict';
import {readPreferences,validIds,validStories,toggleId,toggleSavedStory,persistJSON,persistSavedStories,loadMarketSnapshot,PERSISTENCE_NOTICE,READ_NOTICE} from '../app/browser-data.ts';
const item={id:'story-1',url:'https://example.com/story',title:'Bitcoin news',source:'Publisher',date:'2026-10-22T12:00:00Z',kind:'news',text:'Details',author:'Author',likes:2};
const makeStore=entries=>{const map=new Map(Object.entries(entries));return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)}};
const store=makeStore({'cp-stars':JSON.stringify(['btc-bitcoin',null,3,'bitcoin','']),'cp-saved':'{"not":"an array"}','cp-saved-items':JSON.stringify([item,{...item,id:'bad1',title:8},{...item,id:'bad2',source:{}},{...item,id:'bad3',date:'broken'},{...item,id:'bad4',url:'javascript:alert(1)'},{...item,id:'bad5',text:null},{...item,id:'bad6',kind:'other'},null])});
const before=new Map(store.map);const loaded=readPreferences(()=>store);
assert.deepEqual(loaded.stars,['bitcoin']);assert.deepEqual(loaded.saved,['story-1']);assert.deepEqual(loaded.savedItems,[item]);assert.equal(loaded.notice,READ_NOTICE);
// Invalid mixed arrays aren't blanket-cleared or written back during hydration.
for(const [key,raw] of before)assert.equal(store.map.get(key),raw);
assert.deepEqual(validIds(null),[]);assert.deepEqual(validIds({x:1}),[]);assert.deepEqual(validStories({x:1}),[]);
assert.equal(validStories([{...item,text:undefined}]).length,0);
assert.deepEqual(validStories([{...item,text:''},{...item}]),[{...item,text:''}]);
const optional={...item,id:'optional',author:{bad:true},handle:7,likes:'many'};
assert.deepEqual(validStories([optional]),[{id:'optional',url:item.url,title:item.title,text:item.text,source:item.source,date:item.date,kind:item.kind}]);
for(const malformed of ['invalid JSON','null','42','"string"','{}']){
 const corrupt=makeStore({'cp-stars':malformed,'cp-saved':malformed,'cp-saved-items':malformed});
 const data=readPreferences(()=>corrupt);assert.deepEqual(data.stars,[]);assert.deepEqual(data.saved,[]);assert.deepEqual(data.savedItems,[]);assert.equal(data.notice,READ_NOTICE);
 assert.equal(corrupt.map.get('cp-stars'),malformed);assert.equal(corrupt.map.get('cp-saved-items'),malformed);
}
const denied=()=>{throw Error('SecurityError')};
assert.deepEqual(readPreferences(denied),{stars:[],saved:[],savedItems:[],notice:PERSISTENCE_NOTICE});
assert.equal(persistJSON(denied,'cp-stars',['bitcoin']),false);
const quota=()=>({getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError')}});
let stars=toggleId([],'bitcoin');assert.equal(persistJSON(quota,'cp-stars',stars),false);assert.deepEqual(stars,['bitcoin']);
stars=toggleId(stars,'bitcoin');assert.deepEqual(stars,[]);
let saved=toggleSavedStory([],[],[item],'story-1');
assert.equal(persistSavedStories(quota,saved.saved,saved.savedItems),false);
assert.deepEqual(saved,{saved:['story-1'],savedItems:[item]});
saved=toggleSavedStory(saved.saved,saved.savedItems,[],'story-1');assert.deepEqual(saved,{saved:[],savedItems:[]});
// New bookmarks use one authoritative envelope. Neither legacy key changes,
// even if writing one of those old keys would fail partway through a save.
const partial=makeStore({'cp-saved':'[]','cp-saved-items':'[]'});
const oldSet=partial.setItem;partial.setItem=(key,value)=>{if(key==='cp-saved-items')throw Error('quota on second legacy write');oldSet(key,value)};
assert.equal(persistSavedStories(()=>partial,['story-1'],[item]),true);
assert.equal(partial.map.get('cp-saved'),'[]');assert.equal(partial.map.get('cp-saved-items'),'[]');
assert.deepEqual(readPreferences(()=>partial).saved,['story-1']);assert.deepEqual(readPreferences(()=>partial).savedItems,[item]);
const oldEnvelope=partial.map.get('cp-saved-state-v1');
assert.equal(persistSavedStories(()=>({...partial,setItem:()=>{throw Error('quota')}}),[],[]),false);
assert.equal(partial.map.get('cp-saved-state-v1'),oldEnvelope);
assert.deepEqual(readPreferences(()=>partial).saved,['story-1']);
const validLegacy=makeStore({'cp-saved':'["story-1","missing-record"]','cp-saved-items':JSON.stringify([item])});
const recovered=readPreferences(()=>validLegacy);assert.deepEqual(recovered.saved,['story-1']);assert.deepEqual(recovered.savedItems,[item]);assert.equal(recovered.notice,READ_NOTICE);
assert.equal(validLegacy.map.get('cp-saved'),'["story-1","missing-record"]');
const corruptEnvelope=makeStore({'cp-saved':'["story-1"]','cp-saved-items':JSON.stringify([item]),'cp-saved-state-v1':'broken JSON'});
assert.deepEqual(readPreferences(()=>corruptEnvelope).savedItems,[item]);assert.equal(corruptEnvelope.map.get('cp-saved-state-v1'),'broken JSON');
// A failed identity-migration backup must retain the original stored ID and
// still provide canonical IDs in memory, together with the persistence notice.
const migrationMap=new Map([['cp-stars','["btc-bitcoin"]']]);
const migration=readPreferences(()=>({getItem:k=>migrationMap.get(k)??null,setItem:()=>{throw Error('quota')}}));
assert.deepEqual(migration.stars,['bitcoin']);assert.equal(migration.notice,PERSISTENCE_NOTICE);assert.equal(migrationMap.get('cp-stars'),'["btc-bitcoin"]');
const coin={id:'bitcoin',name:'Bitcoin',symbol:'btc',current_price:100,market_cap:1000,total_volume:100,price_change_percentage_24h:1,market_cap_rank:1};
const snapshot={coins:[coin],provider:'CoinGecko',updatedAt:'2026-10-22T12:00:00Z'};
let reads=0;
const noCache=()=>({getItem:()=>{reads++;throw Error('cache must not be read after network success')},setItem:()=>{throw Error('quota')}});
const fresh=await loadMarketSnapshot(async()=>Response.json(snapshot),noCache);
assert.equal(fresh.offline,false);assert.equal(fresh.storageFailed,true);assert.equal(fresh.snapshot.coins[0].current_price,100);assert.equal(reads,0);
const deniedFresh=await loadMarketSnapshot(async()=>Response.json(snapshot),denied);assert.equal(deniedFresh.offline,false);assert.equal(deniedFresh.storageFailed,true);assert.ok(deniedFresh.snapshot);
const cache=makeStore({'cp-market':JSON.stringify(snapshot)});
const cached=await loadMarketSnapshot(async()=>{throw Error('network down')},()=>cache);assert.equal(cached.offline,true);assert.ok(cached.snapshot);assert.equal(cached.storageFailed,false);
for(const raw of ['broken JSON','{}','{"coins":[]}','null']){
 const data=await loadMarketSnapshot(async()=>{throw Error('network down')},()=>makeStore({'cp-market':raw}));assert.equal(data.offline,true);assert.equal(data.snapshot,null);
}
const unavailable=await loadMarketSnapshot(async()=>{throw Error('network down')},denied);assert.equal(unavailable.snapshot,null);assert.equal(unavailable.storageFailed,true);
for(const field of ['provider_id','gecko_id','source_provider'])for(const badValue of [{bad:true},[],false,2,'']){const repaired=await loadMarketSnapshot(async()=>Response.json({...snapshot,coins:[{...coin,[field]:badValue}]}),()=>cache);assert.equal(repaired.offline,false);assert.equal(repaired.snapshot.coins[0].id,'bitcoin');assert.equal(repaired.snapshot.coins[0].gecko_id,'bitcoin');assert.equal(repaired.snapshot.coins[0].source_provider,'CoinGecko')}
const cachedAfterBadNetwork=await loadMarketSnapshot(async()=>Response.json({...snapshot,coins:[{...coin,name:4}]}),()=>cache);assert.equal(cachedAfterBadNetwork.offline,true);assert.equal(cachedAfterBadNetwork.snapshot.coins[0].name,'Bitcoin');
console.log('Browser data validation, retained records, in-memory toggles, blocked/quota storage and fresh-network cache isolation: passed.');
