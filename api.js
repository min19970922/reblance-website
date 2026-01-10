/**
 * api.js - 官方數據源穩定版
 * 報價：Yahoo v8 Chart
 * 名稱：Yahoo Search Suggest (官方接口)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
];

/**
 * 透過 Yahoo 官方搜尋建議接口獲取名稱 (最穩定)
 */
async function fetchNameFromYahoo(ticker) {
  try {
    // 處理台股代號增加後綴
    const query = /^\d{4,6}$/.test(ticker) ? `${ticker}.TW` : ticker;

    // Yahoo 官方搜尋預覽接口，專門回傳標的全稱
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${query}&quotesCount=1&newsCount=0&lang=zh-Hant-TW&region=TW`;

    const proxyUrl = `${PROXIES[0]}${encodeURIComponent(searchUrl)}`;
    const res = await fetch(proxyUrl);
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);

    if (data.quotes && data.quotes.length > 0) {
      // 優先取 longname，其次取 shortname
      return data.quotes[0].longname || data.quotes[0].shortname;
    }
  } catch (e) {
    console.warn("Yahoo 名稱抓取失敗:", e);
  }
  return null;
}

/**
 * 抓取單一資產報價與名稱
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}/.test(cleanTicker);

  // 1. 非同步抓取名稱 - 改用官方 Search 接口
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

  // 2. 抓取報價 (Yahoo v8 Chart)
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
      // 兜底：如果沒抓到名稱，顯示 Ticker
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
