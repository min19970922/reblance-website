/**
 * api.js 最終穩定版
 * 職責：處理穩定報價 (v8/v10)，並透過 Yahoo 語系設定嘗試抓取中文名稱
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

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

  const tryFetchData = async (targetTicker) => {
    // 使用 v8 接口搭配繁體中文參數，這是目前您環境下最穩定的報價路徑
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 解析 AllOrigins 特有的 contents 封裝
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const result = data.chart?.result?.[0];
        if (result && result.meta) {
          return {
            price: result.meta.regularMarketPrice || result.meta.previousClose,
            name:
              result.meta.shortName ||
              result.meta.longName ||
              result.meta.symbol,
          };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  // 1. 執行報價抓取
  let result = null;
  if (isTaiwan && !ticker.includes(".")) {
    result =
      (await tryFetchData(ticker + ".TW")) ||
      (await tryFetchData(ticker + ".TWO"));
  } else {
    result = await tryFetchData(ticker);
  }

  // 2. 處理資料更新
  if (result && result.price) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      // 更新價格
      asset.price = result.price;

      // 名稱邏輯：檢查是否有中文字元
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        // 若抓不到中文，且原本是空值，則顯示 Ticker
        asset.fullName = ticker;
      }

      // --- 核心修正：存檔後必須渲染，下方文字才會變 ---
      saveToStorage();
      renderMainUI(acc);

      if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
      return true;
    }
  }

  if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
  return false;
}

/**
 * 批次同步所有資產
 */
export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("更新報價中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 增加延遲防止被 Yahoo 封鎖
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(successCount > 0 ? `同步完成 (${successCount} 筆)` : "同步失敗");
}
