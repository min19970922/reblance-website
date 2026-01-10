/**
 * api.js - 強制連線修正版
 * 解決 500/522 錯誤與 CORS 封鎖
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 調整 Proxy 優先順序：將目前失效的 AllOrigins 移至最後
const PROXIES = [
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

/**
 * 透過 Yahoo 官方搜尋接口獲取名稱 (此接口較不受 CORS 限制)
 */
async function fetchNameFromYahoo(ticker) {
  try {
    const query = /^\d{4,6}$/.test(ticker) ? `${ticker}.TW` : ticker;
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${query}&quotesCount=1&newsCount=0&lang=zh-Hant-TW&region=TW`;

    // 名稱抓取優先使用第一個穩定代理
    const res = await fetch(PROXIES[0] + encodeURIComponent(searchUrl));
    const data = await res.json();

    if (data.quotes && data.quotes.length > 0) {
      return data.quotes[0].longname || data.quotes[0].shortname;
    }
  } catch (e) {
    console.warn("名稱抓取跳過，將由報價接口嘗試");
  }
  return null;
}

/**
 * 抓取單一資產報價與名稱 (強化輪播機制)
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}$/.test(cleanTicker);

  // 1. 執行名稱抓取 (不卡住主流程)
  fetchNameFromYahoo(ticker).then((name) => {
    if (name) {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      const asset = acc.assets.find((a) => a.id === id);
      if (asset) {
        asset.fullName = name;
        saveToStorage();
        renderMainUI(acc);
      }
    }
  });

  // 2. 核心報價抓取 (v8 接口)
  const tryFetchPrice = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 根據代理來源決定解析方式
        let data =
          proxy.includes("allorigins") && rawData.contents
            ? JSON.parse(rawData.contents)
            : rawData;

        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return meta.regularMarketPrice || meta.previousClose;
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 失效，切換中...`);
        continue;
      }
    }
    return null;
  };

  let priceResult =
    isTaiwan && !ticker.includes(".")
      ? (await tryFetchPrice(ticker + ".TW")) ||
        (await tryFetchPrice(ticker + ".TWO"))
      : await tryFetchPrice(ticker);

  if (priceResult) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = priceResult;
      if (!asset.fullName || asset.fullName === "---") asset.fullName = ticker;

      saveToStorage();
      renderMainUI(acc);
      if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
      return true;
    }
  }

  if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
  return false;
}

export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("切換備援代理中，請稍候...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      // 拉長延遲到 1200ms 避免被代理伺服器視為攻擊
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("報價已透過備援線路更新");
}
