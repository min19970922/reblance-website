/**
 * api.js - 核心修復版
 * 報價：Yahoo v8 Chart
 * 名稱：Yahoo Search API (抓不到則回傳代號)
 */

import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.allorigins.win/get?url=",
];

/**
 * 抓取繁體中文全名
 */
async function fetchChineseName(ticker) {
  const cleanTicker = ticker.split(".")[0];
  const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${cleanTicker}&quotesCount=1&newsCount=0&lang=zh-Hant-TW&region=TW`;

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
  const isTaiwanAsset = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetchPriceV8 = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;
    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;
        const res = await fetch(finalUrl);
        if (res.status === 404) return null;
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

  // 1. 報價輪詢
  let result = null;
  if (isTaiwanAsset && !ticker.includes(".")) {
    result =
      (await tryFetchPriceV8(ticker + ".TW")) ||
      (await tryFetchPriceV8(ticker + ".TWO"));
  } else {
    result = await tryFetchPriceV8(ticker);
  }

  // 2. 更新數據
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((as) => as.id === id);
    if (asset) {
      asset.price = result.price;
      saveToStorage();
      if (window.renderMainUI) window.renderMainUI(acc);

      // 3. 名稱抓取邏輯：抓不到就存入代號
      fetchChineseName(result.finalTicker).then((name) => {
        const label = document.getElementById(`nameLabel-${id}`);
        const hasChinese = (str) => str && /[\u4e00-\u9fa5]/.test(str);

        if (name && hasChinese(name)) {
          asset.fullName = name;
          if (label) {
            label.innerText = name;
            label.classList.remove("text-rose-300", "animate-pulse");
            label.classList.add("text-rose-600");
          }
        } else {
          // --- 修復點：如果沒抓到中文，立即存入代號並停止 Loading 狀態 ---
          asset.fullName = ticker;
          if (label) {
            label.innerText = ticker;
            label.classList.remove("text-rose-300", "animate-pulse");
            label.classList.add("text-rose-400");
          }
        }
        // 抓完後強制存檔，防止下次重新整理又變回 "---"
        saveToStorage();
      });

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
  showToast("正在更新報價中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("更新完成");
}
