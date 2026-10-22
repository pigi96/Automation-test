import { GET as marketFeed } from '../radar/route';
type Entry = { at: number; data: unknown };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
async function remote(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Coinpulse/1.0 (public crypto news reader)' }, signal: AbortSignal.timeout(14000) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json();
}
async function snapshot() {
  const response = await marketFeed(new Request('https://coinpulse.local/api/radar?mode=market'));
  const data: any = await response.json();
  if (!response.ok) throw new Error('Market data is unavailable. Please retry shortly.');
  return data;
}
async function chart(id: string, days: number) {
  const market = await snapshot();
  const coin = market.coins.find((c: any) => c.id === id);
  if (!coin) throw new Error('Select a coin in the current top 100 market list.');
  try {
    let geckoId = coin.id;
    if (market.provider !== 'CoinGecko') {
      const search = await remote('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(coin.name));
      const match = search.coins?.find((c: any) => c.name.toLowerCase() === coin.name.toLowerCase() && c.symbol.toLowerCase() === coin.symbol.toLowerCase());
      if (!match) throw new Error('No matching historical asset.');
      geckoId = match.id;
    }
    const result = await remote(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(geckoId)}/market_chart?vs_currency=usd&days=${days}`);
    const prices = (result.prices || []).filter((p: any) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0).sort((a: number[], b: number[]) => a[0] - b[0]);
    if (prices.length < 2) throw new Error('Not enough historical prices.');
    const volume = new Map<number, number>(result.total_volumes || []);
    const stride = Math.max(1, Math.ceil(prices.length / 720));
    const points = prices.filter((_: unknown, i: number) => i % stride === 0 || i === prices.length - 1).map(([time, price]: number[]) => ({ time, price, volume: volume.get(time) ?? null }));
    return { points, coinId: id, days, provider: 'CoinGecko', volumeUnit: 'USD', volumeKind: 'rolling24h', updatedAt: new Date().toISOString(), sampled: stride > 1 };
  } catch {
    // Exchange fallback verifies asset identity, not only an ambiguous ticker.
    const symbol = coin.symbol.toUpperCase();
    if (!/^[A-Z0-9]{1,15}$/.test(symbol)) throw new Error('Price history is temporarily unavailable for this asset.');
    const currency = await remote('https://api.exchange.coinbase.com/currencies/' + symbol);
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sameAsset = normalize(currency.name) === normalize(coin.name) || (symbol === 'ETH' && normalize(coin.name) === 'ethereum' && normalize(currency.name) === 'ether');
    if (!sameAsset) throw new Error('No verified exchange history is available for this asset. Please retry later.');
    const granularity = days === 1 ? 300 : days === 7 ? 3600 : days === 30 ? 21600 : 86400;
    const end = Math.floor(Date.now() / 1000), start = end - days * 86400;
    const candles: number[][] = [];
    for (let cursor = start; cursor < end; cursor += granularity * 299) {
      const until = Math.min(end, cursor + granularity * 299);
      const params = new URLSearchParams({granularity: String(granularity), start: new Date(cursor * 1000).toISOString(), end: new Date(until * 1000).toISOString()});
      const batch = await remote(`https://api.exchange.coinbase.com/products/${symbol}-USD/candles?${params}`);
      if (!Array.isArray(batch)) throw new Error('Exchange history is unavailable for this trading pair.');
      candles.push(...batch);
    }
    const points = [...new Map(candles.filter(c => c.length >= 6 && c.every(Number.isFinite) && c[4] > 0 && c[0] >= start && c[0] + granularity <= end).map(c => [(c[0] + granularity) * 1000, {time: (c[0] + granularity) * 1000, price: c[4], volume: c[5]}])).values()].sort((a, b) => a.time - b.time);
    if (points.length < 2) throw new Error('Historical prices are temporarily unavailable. Try again shortly.');
    return {points, coinId: id, days, provider: 'Coinbase Exchange', volumeUnit: symbol, volumeKind: 'candle', updatedAt: new Date().toISOString(), fallback: true, intervalSeconds: granularity};
  }
}
async function globalData() {
  const results = await Promise.allSettled([
    remote('https://api.coingecko.com/api/v3/global'),
    remote('https://api.alternative.me/fng/?limit=1'),
  ]);
  const global = results[0].status === 'fulfilled' ? results[0].value.data : null;
  const fear = results[1].status === 'fulfilled' ? results[1].value.data?.[0] : null;
  if (!global && !fear) throw new Error('Market context providers are temporarily unavailable.');
  return { global: global ? { marketCap: global.total_market_cap?.usd, volume: global.total_volume?.usd, btcDominance: global.market_cap_percentage?.btc, ethDominance: global.market_cap_percentage?.eth, change: global.market_cap_change_percentage_24h_usd, timestamp: global.updated_at } : null, fear: fear ? { value: Number(fear.value), label: fear.value_classification, time: Number(fear.timestamp) * 1000 } : null, updatedAt: new Date().toISOString() };
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get('mode') || 'chart';
  const id = params.get('id') || '';
  const days = Number(params.get('days') || '7');
  if (!['chart', 'global'].includes(mode) || (mode === 'chart' && (!/^[a-z0-9-]{1,100}$/.test(id) || ![1, 7, 30, 90, 365].includes(days)))) return Response.json({ error: 'Invalid chart request.' }, { status: 400 });
  const key = `${mode}:${id}:${days}`;
  const edge = (globalThis as any).caches?.default;
  const edgeKey = new Request(new URL('/_cache/market-history-v2/' + encodeURIComponent(key), request.url));
  const staleKey = new Request(edgeKey.url + '/last-success');
  if(edge){try{const shared=await edge.match(edgeKey);if(shared)return new Response(shared.body,{status:shared.status,headers:new Headers(shared.headers)});}catch{}}
  const old = cache.get(key);
  if (old && Date.now() - old.at < 300000) return Response.json(old.data);
  try {
    let task = pending.get(key);
    if (!task) { task = mode === 'global' ? globalData() : chart(id, days); pending.set(key, task); }
    const data = await task;
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), data });
    if(edge){try{await Promise.all([edge.put(edgeKey,Response.json(data,{headers:{'Cache-Control':'public, max-age=300'}})),edge.put(staleKey,Response.json(data,{headers:{'Cache-Control':'public, max-age=86400'}}))]);}catch{}}
    return Response.json(data);
  } catch (error) {
    if (old) return Response.json({ ...old.data as object, stale: true });
    if(edge){try{const previous=await edge.match(staleKey);if(previous)return Response.json({...await previous.json() as object,stale:true});}catch{}}
    return Response.json({ error: error instanceof Error ? error.message : 'Market source unavailable.' }, { status: 502 });
  } finally { pending.delete(key); }
}
