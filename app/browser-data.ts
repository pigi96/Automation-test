import type { Coin } from './market-utils';
import { migrateBrowserIdentity, migrateWatchlist, normalizeAsset } from './asset-identity';
export type Story = {id:string;url:string;title:string;text:string;source:string;date:string;kind:'news'|'social';author?:string;handle?:string;likes?:number};
export type BrowserStore=Pick<Storage,'getItem'|'setItem'>;
export type StoreAccess=()=>BrowserStore;
export const PERSISTENCE_NOTICE="This browser can't save changes. Your watchlist and saved stories still work here, but changes won't persist after you close this page.";
export const READ_NOTICE='Some saved entries could not be loaded. Valid entries are still available, and the original browser data has been kept.';
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
export function validIds(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter(text))]:[]}
function validURL(value:unknown):value is string {if(typeof value!=='string')return false;try{return ['http:','https:'].includes(new URL(value).protocol)}catch{return false}}
export function validStories(value:unknown):Story[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();
 return value.flatMap(item=>{
  if(!item||typeof item!=='object'||!text(item.id)||!validURL(item.url)||!text(item.title)||!text(item.source)||!text(item.date)||!Number.isFinite(Date.parse(item.date))||!['news','social'].includes(item.kind)||('text' in item&&typeof item.text!=='string')||seen.has(item.id))return [];
  seen.add(item.id);
  return [{id:item.id,url:item.url,title:item.title,text:item.text||'',source:item.source,date:item.date,kind:item.kind,...(typeof item.author==='string'?{author:item.author}:{}),...(typeof item.handle==='string'?{handle:item.handle}:{}),...(Number.isFinite(item.likes)&&item.likes>=0?{likes:item.likes}:{})}];
 });
}
export function readPreferences(access:StoreAccess){
 let persistenceFailed=false,invalid=false;const present=new Set<string>();
 const read=(key:string):unknown=>{try{const raw=access().getItem(key);if(raw===null)return [];present.add(key);return JSON.parse(raw)}catch(error){if(error instanceof SyntaxError)invalid=true;else persistenceFailed=true;return []}};
 // Keep #5's backed-up identity migration, and expose blocked writes/reads rather
 // than allowing its deliberately non-throwing adapter to hide storage failure.
 try{const store=access();migrateBrowserIdentity({getItem:key=>{try{return store.getItem(key)}catch(error){persistenceFailed=true;throw error}},setItem:(key,value)=>{try{store.setItem(key,value)}catch(error){persistenceFailed=true;throw error}}})}catch{persistenceFailed=true}
 const rawStars=read('cp-stars'),legacySaved=read('cp-saved'),legacyStories=read('cp-saved-items'),envelope=read('cp-saved-state-v1') as any;
 let rawSaved=legacySaved,rawStories=legacyStories,usingEnvelope=false;
 if(present.has('cp-saved-state-v1')){
  if(envelope&&envelope.version===1&&Array.isArray(envelope.saved)&&Array.isArray(envelope.savedItems)){rawSaved=envelope.saved;rawStories=envelope.savedItems;usingEnvelope=true}
  else invalid=true;
 }
 const stars=migrateWatchlist(validIds(rawStars)),ids=validIds(rawSaved),stories=validStories(rawStories);
 // A bookmark without a renderable stored story must not show a ghost marker.
 // Recover valid legacy records even if the old ID list is corrupt. Reconcile
 // only the in-memory view; never clear or rewrite the original keys.
 const savedItems=usingEnvelope?stories.filter(item=>ids.includes(item.id)):stories;
 const saved=[...new Set([...ids.filter(id=>savedItems.some(item=>item.id===id)),...(!usingEnvelope?savedItems.map(item=>item.id):[])])];
 for(const [raw,rows] of [[rawStars,validIds(rawStars)],[rawSaved,saved],[rawStories,savedItems]] as [unknown,unknown[]][]){if(!Array.isArray(raw)||raw.length!==rows.length)invalid=true}
 return {stars,saved,savedItems,notice:persistenceFailed?PERSISTENCE_NOTICE:invalid?READ_NOTICE:''};
}
export function persistJSON(access:StoreAccess,key:string,value:unknown):boolean {try{access().setItem(key,JSON.stringify(value));return true}catch{return false}}
export function persistSavedStories(access:StoreAccess,saved:string[],savedItems:Story[]):boolean {
 // One authoritative write prevents quota failures from splitting IDs/records.
 // Legacy keys are retained for recovery and read only until this exists.
 return persistJSON(access,'cp-saved-state-v1',{version:1,saved,savedItems});
}
export function toggleId(ids:string[],id:string):string[]{return ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]}
export function toggleSavedStory(saved:string[],records:Story[],available:Story[],id:string){
 const next=toggleId(saved,id);
 const stories=validStories([...records,...available]);
 return {saved:next,savedItems:next.flatMap(key=>{const item=stories.find(i=>i.id===key);return item?[item]:[]})};
}
export type MarketSnapshot={coins:Coin[];provider:'CoinGecko'|'CoinPaprika';updatedAt:string;stale?:boolean};
export function validMarketSnapshot(value:unknown):MarketSnapshot|null {
 const data=value as any;
 if(!data||!['CoinGecko','CoinPaprika'].includes(data.provider)||!Array.isArray(data.coins)||!text(data.updatedAt)||!Number.isFinite(Date.parse(data.updatedAt)))return null;
 const coins=data.coins.filter((c:any)=>c&&text(c.id)&&text(c.name)&&text(c.symbol)&&Number.isFinite(c.current_price)&&c.current_price>0&&Number.isFinite(c.market_cap)&&c.market_cap>=0&&Number.isFinite(c.total_volume)&&c.total_volume>=0&&Number.isFinite(c.price_change_percentage_24h)&&Number.isFinite(c.market_cap_rank)&&c.market_cap_rank>0).map((c:Coin)=>{const {provider_id,gecko_id,source_provider,...record}=c;return normalizeAsset({...record,...(text(provider_id)?{provider_id}:{}),...(c.sparkline_in_7d?{sparkline_in_7d:{price:Array.isArray(c.sparkline_in_7d.price)?c.sparkline_in_7d.price.filter(Number.isFinite):[]}}:{})},data.provider)});
 if(!coins.length)return null;
 return {coins,provider:data.provider,updatedAt:data.updatedAt,stale:data.stale===true};
}
export async function loadMarketSnapshot(fetcher:()=>Promise<Response>,access:StoreAccess):Promise<{snapshot:MarketSnapshot|null;offline:boolean;storageFailed:boolean}>{
 // Network success and cache writes deliberately have separate failure paths.
 // Quota/security errors must never turn a fresh response into an offline one.
 try{
  const response=await fetcher();const data=await response.json();
  if(!response.ok)throw Error('Market request failed');
  const snapshot=validMarketSnapshot(data);if(!snapshot)throw Error('Invalid market response');
  return {snapshot,offline:false,storageFailed:!persistJSON(access,'cp-market',snapshot)};
 }catch{
  try{const raw=access().getItem('cp-market');return {snapshot:raw?validMarketSnapshot(JSON.parse(raw)):null,offline:true,storageFailed:false}}
  catch{return {snapshot:null,offline:true,storageFailed:true}}
 }
}
