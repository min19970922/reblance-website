/**
 * api.js - 雙接口穩定版 (v8報價 + v7名稱)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

// 針對 1101 等標的建立基礎備援清單
const BACKUP_NAMES = {
  1101: "台泥",
  1102: "亞泥",
  2330: "台積電",
  "0050": "元大台灣50",
  "00919": "群益台灣精選高息",
};

/**
 * 透過 v7 quote 接口專門獲取中文名稱
 */
async function fetchNameFromV7(targetTicker) {
  const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;
  for (let proxy of PROXIES) {
    try {
      const finalUrl = proxy.includes("allorigins")
        ? proxy + encodeURIComponent(yahooUrl)
        : proxy + yahooUrl;
      const res = await fetch(finalUrl);
      if (!res.ok) continue;
      const rawData = await res.json();
      const data = proxy.includes("allorigins")
        ? JSON.parse(rawData.contents)
        : rawData;
      const result = data.quoteResponse?.result?.[0];
      if (result && (result.longName || result.shortName)) {
        return result.longName || result.shortName;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

/**
 * 抓取單一資產報價 (v8) 與名稱 (v7)
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}$/.test(cleanTicker);

  // 1. 抓取報價 (使用最穩定的 v8 接口)
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

  // 執行報價邏輯 (包含上市櫃判定)
  let priceResult = null;
  let finalTicker = ticker;
  if (isTaiwan && !ticker.includes(".")) {
    priceResult = await tryFetchPrice(ticker + ".TW");
    if (priceResult) {
      finalTicker = ticker + ".TW";
    } else {
      priceResult = await tryFetchPrice(ticker + ".TWO");
      if (priceResult) finalTicker = ticker + ".TWO";
    }
  } else {
    priceResult = await tryFetchPrice(ticker);
  }

  // 2. 抓取名稱 (使用 v7 接口，並加入備援)
  fetchNameFromV7(finalTicker).then((name) => {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (name && hasChinese(name)) {
        asset.fullName = name;
      } else if (BACKUP_NAMES[cleanTicker]) {
        asset.fullName = BACKUP_NAMES[cleanTicker];
      }
      saveToStorage();
      renderMainUI(acc);
    }
  });

  // 3. 更新報價結果
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
  showToast("正在透過雙接口同步數據...");

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
