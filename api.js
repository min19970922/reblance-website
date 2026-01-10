/**
 * api.js - 雙軌制穩定版
 * 報價：Yahoo Finance v8
 * 名稱：Google Finance Suggest API
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
];

/**
 * 透過 Google Finance Suggest API 獲取中文名稱
 */
async function fetchNameFromGoogle(ticker) {
  try {
    // 處理台股代號格式，Google 習慣用 TPE:2330
    const googleTicker = ticker.includes(".")
      ? ticker.replace(".TW", "").replace(".TWO", "")
      : ticker;
    const searchUrl = `https://www.google.com/finance/explorer/search?q=${googleTicker}&client=finance`;

    // 注意：Google Suggest 接口通常需要透過代理獲取
    const proxyUrl = `${PROXIES[0]}${encodeURIComponent(searchUrl)}`;
    const res = await fetch(proxyUrl);
    const rawData = await res.json();
    const data = JSON.parse(rawData.contents);

    // 解析 Google 搜尋建議中的名稱
    if (data && data.matches && data.matches.length > 0) {
      return data.matches[0].t; // 回傳標的名稱，例如「台積電」
    }
  } catch (e) {
    console.warn("Google Finance 名稱抓取失敗:", e);
  }
  return null;
}

/**
 * 抓取報價 (Yahoo v8) 與 名稱 (Google)
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}/.test(cleanTicker);

  // 1. 非同步抓取名稱 (Google) - 不卡住報價流程
  fetchNameFromGoogle(cleanTicker).then((name) => {
    if (name) {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      const asset = acc.assets.find((a) => a.id === id);
      if (asset) {
        asset.fullName = name;
        saveToStorage();
        renderMainUI(acc); // 名稱抓到後立即刷新畫面
      }
    }
  });

  // 2. 抓取報價 (Yahoo v8)
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
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return meta.regularMarketPrice || meta.previousClose;
        }
      } catch (e) {
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
      // 如果 Google 沒回傳，且目前 fullName 是空的，才顯示代號
      if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }
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
  showToast("正在更新計畫報價與名稱...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("同步完成");
}
