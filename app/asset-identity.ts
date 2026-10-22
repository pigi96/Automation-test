/** Deliberate ID pairs, never ticker-only guesses. Unknown assets stay provider-specific.
 * ID/name/symbol metadata checked 2026-10-22 against the public primary lists:
 * https://api.coingecko.com/api/v3/coins/list and https://api.coinpaprika.com/v1/coins.
 * Names/symbols are
 * checked as a guard against provider ID reuse. Extend this small registry only
 * after checking both providers describe the same underlying asset/network.
 */
const assets = [
  {gecko:'bitcoin',paprika:'btc-bitcoin',symbol:'btc',names:['bitcoin']},
  {gecko:'ethereum',paprika:'eth-ethereum',symbol:'eth',names:['ethereum']},
  {gecko:'solana',paprika:'sol-solana',symbol:'sol',names:['solana']},
  {gecko:'tether',paprika:'usdt-tether',symbol:'usdt',names:['tether','tether usd','tether usd₮']},
  {gecko:'usd-coin',paprika:'usdc-usd-coin',symbol:'usdc',names:['usd coin','usdc']},
  {gecko:'dogecoin',paprika:'doge-dogecoin',symbol:'doge',names:['dogecoin']},
  {gecko:'cardano',paprika:'ada-cardano',symbol:'ada',names:['cardano']},
  {gecko:'chainlink',paprika:'link-chainlink',symbol:'link',names:['chainlink']},
  {gecko:'litecoin',paprika:'ltc-litecoin',symbol:'ltc',names:['litecoin']},
  {gecko:'bitcoin-cash',paprika:'bch-bitcoin-cash',symbol:'bch',names:['bitcoin cash']},
] as const;
export type AssetIdentity = {id:string;name:string;symbol:string;source_provider?:string;provider_id?:string;gecko_id?:string;identity_verified?:boolean};
const normalize=(s:string)=>s.trim().toLowerCase();
export function normalizeAsset<T extends AssetIdentity>(coin:T, provider=coin.source_provider||'CoinGecko'):T & AssetIdentity {
  // Idempotent for API data, browser cache restoration and old snapshots.
  const providerId=coin.provider_id||coin.id;
  const pair=assets.find(a=>(provider==='CoinGecko'?a.gecko:a.paprika)===providerId && a.symbol===normalize(coin.symbol) && (a.names as readonly string[]).includes(normalize(coin.name)));
  const reserved=assets.some(a=>a.gecko===providerId||a.paprika===providerId);
  const id=pair?.gecko||(provider==='CoinPaprika'?'paprika-'+providerId:reserved?'coingecko-'+providerId:providerId);
  return {...coin,id,source_provider:provider,provider_id:providerId,gecko_id:pair?.gecko||(provider==='CoinGecko'?providerId:undefined),identity_verified:!!pair};
}
/** Curated legacy aliases migrate even when that asset is outside today's list.
 * Unmapped IDs are retained, never deleted or matched by a shared ticker/name.
 */
export function canonicalSavedId(id:string):string {
  return assets.find(a=>a.gecko===id||a.paprika===id)?.gecko||id;
}
export function migrateWatchlist(ids:string[]):string[]{return [...new Set(ids.map(canonicalSavedId))]}
export function migrateSavedRecords<T extends {coinId:string}>(records:T[]):T[]{return records.map(r=>({...r,coinId:canonicalSavedId(r.coinId)}))}
export function migrateBrowserIdentity(storage:Pick<Storage,'getItem'|'setItem'>){
  for(const [key,watchlist] of [['cp-stars',true],['cp-holdings-v1',false],['cp-alerts-v1',false]] as const){
    try{
      const raw=storage.getItem(key);if(!raw)continue;
      const rows=JSON.parse(raw);if(!Array.isArray(rows))continue;
      const valid=watchlist?rows.every(r=>typeof r==='string'):rows.every(r=>r&&typeof r.coinId==='string');if(!valid)continue;
      const next=JSON.stringify(watchlist?migrateWatchlist(rows):migrateSavedRecords(rows));
      if(next!==raw){const backup=key+'-before-identity-v1';if(!storage.getItem(backup))storage.setItem(backup,raw);storage.setItem(key,next)}
    }catch{/* A corrupt entry or storage failure must not discard its original records. */}
  }
}
