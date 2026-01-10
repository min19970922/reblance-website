/**
 * api.js (自動化名稱修正版)
 * 職責：處理報價抓取，並整合 Fugle API 自動獲取台股中文名稱
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

/**
 * 輔助函式：透過 Fugle API 獲取台股中文名稱
 * 此 API 對台股名稱支援度最高，且新股上市會自動同步
 */
async function getTaiwanStockName(ticker) {
  try {
    const res = await fetch(
      `https://api.fugle.tw/marketdata/v1.0/stock/intraday/tickers/${ticker}`
    );
    if (res.ok) {
      const data = await res.json();
      return data.name; // 回傳「台積電」
    }
  } catch (e) {
    console.warn(`[Fugle] 無法獲取代號 ${ticker} 的名稱`);
  }
  return null;
}

/**
 * 抓取單一資產即時價格與中文名稱
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}/.test(cleanTicker);

  const tryFetchPrice = async (targetTicker) => {
    // 使用 v10 參數，嘗試抓取價格與名稱
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const result = data.quoteSummary?.result?.[0]?.price;
        if (result) {
          return {
            price:
              result.regularMarketPrice?.raw ||
              result.regularMarketPreviousClose?.raw,
            name: result.shortName || result.longName,
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
      (await tryFetchPrice(ticker + ".TW")) ||
      (await tryFetchPrice(ticker + ".TWO"));
  } else {
    result = await tryFetchPrice(ticker);
  }

  // 2. 處理資料與名稱更新
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      // 更新價格
      asset.price = result.price;

      // 名稱邏輯：判斷字串是否含有中文
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

      if (isTaiwan) {
        // 台股優先嘗試 Fugle API 名稱
        const fugleName = await getTaiwanStockName(cleanTicker);
        if (fugleName) {
          asset.fullName = fugleName;
        } else if (result.name && hasChinese(result.name)) {
          // Fugle 失敗才用 Yahoo 的中文
          asset.fullName = result.name;
        }
      } else {
        // 非台股（美股等）直接用 Yahoo 名稱
        if (result.name) asset.fullName = result.name;
      }

      // 如果最後還是沒名稱，才給予代號墊底
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

/**
 * 批次同步當前計畫所有資產
 */
export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("正在自動獲取最新報價與名稱...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 避免請求過快
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0
      ? `已成功更新 ${successCount} 項標的`
      : "更新失敗，請檢查網路"
  );
}
