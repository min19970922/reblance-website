/**
 * api.js
 * 職責：處理外部數據通訊、CORS 代理切換、以及報價資料的解析
 */
import { renderMainUI, showToast } from "./ui.js";

// 1. 定義常用的 CORS 代理列表，增加穩定性
const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
  "https://cors-anywhere.herokuapp.com/",
];

/**
 * 抓取單一標的的實時報價
 * @param {number} id - 資產在 state 中的唯一標識
 * @param {string} symbol - 股票代號 (如: 2330 或 VT)
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;

  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}[A-Z]?$/.test(ticker);

  // 嘗試不同的代理進行抓取
  const tryFetch = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        let finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        let data;
        if (proxy.includes("allorigins")) {
          const json = await res.json();
          data = JSON.parse(json.contents);
        } else {
          data = await res.json();
        }

        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return {
            price: meta.regularMarketPrice || meta.previousClose,
            name: meta.shortName || meta.longName || meta.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 請求失敗，嘗試下一個...`);
      }
    }
    return null;
  };

  let result = null;
  // 台股自動補完邏輯
  if (isTaiwan && !ticker.includes(".")) {
    result = await tryFetch(ticker + ".TW");
    if (!result) result = await tryFetch(ticker + ".TWO");
  } else {
    result = await tryFetch(ticker);
  }

  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset && result.price) {
      asset.price = result.price;

      // 處理中文名稱邏輯
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      renderMainUI(acc);
      if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
      return true;
    }
  }

  if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
  return false;
}

/**
 * 批次同步所有資產報價
 */
export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("正在聯繫資料庫...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 防止請求過快被 Yahoo 封鎖，間隔 1.2 秒
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0
      ? `同步成功 ${successCount} 筆`
      : "連線逾時，請檢查代理狀態"
  );
}
