/**
 * api.js - 核心修復版
 * 1. 價格使用 v8 (確保報價成功)
 * 2. 名稱使用 Search API (確保中文不跳掉)
 * 3. 修正上櫃 (.TWO) 與 債券 (00722B) 抓取邏輯
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.allorigins.win/get?url=",
];

/**
 * 專職負責抓取繁體中文全名 (Search 接口對 GitHub Pages 最友善)
 */
async function fetchChineseName(ticker) {
  const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}&quotesCount=1&newsCount=0&lang=zh-Hant-TW&region=TW`;

  for (let proxy of PROXIES) {
    try {
      const finalUrl = proxy.includes("allorigins")
        ? proxy + encodeURIComponent(searchUrl)
        : proxy + searchUrl;
      const res = await fetch(finalUrl);
      if (!res.ok) continue;

      const rawData = await res.json();
      const data = proxy.includes("allorigins")
        ? JSON.parse(rawData.contents)
        : rawData;

      if (data.quotes && data.quotes.length > 0) {
        // 抓取 longname (例如：亞泥)
        return data.quotes[0].longname || data.quotes[0].shortname;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  // 支援台股代號與債券 (如 00722B)
  const isTaiwanAsset = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetchPriceV8 = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;
    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;
        const res = await fetch(finalUrl);
        if (res.status === 404) return null; // 此市場無此代號
        if (!res.ok) continue;

        const rawData = await res.json();
        const data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;
        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return {
            price: meta.regularMarketPrice || meta.previousClose,
            finalTicker: targetTicker,
          };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  // 1. 報價輪詢：先嘗試上市 (.TW) 若失敗則改嘗試上櫃 (.TWO)
  let result = null;
  if (isTaiwanAsset && !ticker.includes(".")) {
    result = await tryFetchPriceV8(ticker + ".TW");
    if (!result) result = await tryFetchPriceV8(ticker + ".TWO");
  } else {
    result = await tryFetchPriceV8(ticker);
  }

  // 2. 更新數據
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((as) => as.id === id);
    if (asset) {
      asset.price = result.price;

      // 價格一變，立刻讓 UI 重新計算下方建議文字
      saveToStorage();
      renderMainUI(acc);

      // 3. 非同步抓取名稱 (Search API)
      fetchChineseName(result.finalTicker).then((name) => {
        const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
        if (name && hasChinese(name)) {
          asset.fullName = name;
          saveToStorage();
          renderMainUI(acc); // 名稱抓到後再次刷新
        }
      });

      // 預設 buffer 名稱
      if (!asset.fullName || asset.fullName === "---") asset.fullName = ticker;

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
  showToast("分流同步：報價(v8) + 名稱(Search)...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 1000)); // 提高延遲確保 Proxy 穩定
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("同步完成");
}
