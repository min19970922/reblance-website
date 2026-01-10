/**
 * api.js - 自動回退版
 * 報價：Yahoo v8 Chart
 * 名稱：Yahoo Search API (抓不到則回傳代號)
 */
import { renderMainUI, showToast } from "./ui.js";
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
  // 針對基金或債券，Search 接口通常需要乾淨的代號
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
      renderMainUI(acc);

      // 3. 名稱抓取邏輯：抓不到就回傳代號
      fetchChineseName(result.finalTicker).then((name) => {
        const label = document.getElementById(`nameLabel-${id}`);
        const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

        if (name && hasChinese(name)) {
          asset.fullName = name;
          if (label) {
            label.innerText = name;
            label.classList.remove("text-rose-300", "animate-pulse");
            label.classList.add("text-rose-600");
          }
        } else {
          // --- 重點：抓不到名稱時，直接顯示代號並停止 Loading ---
          asset.fullName = ticker;
          if (label) {
            label.innerText = ticker;
            label.classList.remove("text-rose-300", "animate-pulse");
            label.classList.add("text-rose-400"); // 用較淡的顏色代表這是代號
          }
        }
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
  showToast("更新報價中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("同步完成");
}
