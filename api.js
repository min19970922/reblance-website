/**
 * api.js
 * 修正重點：
 * 1. 強化名稱抓取：確保從 v10 API 的多個可能欄位中擷取中文名稱。
 * 2. 修正連動問題：確保在抓到名稱後，呼叫 renderMainUI 以更新下方「再平衡建議」的顯示。
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

/**
 * 輔助函式：透過 Fugle API 獲取台股中文名稱 (自動化且最精準)
 */
async function getTaiwanStockName(ticker) {
  try {
    const res = await fetch(
      `https://api.fugle.tw/marketdata/v1.0/stock/intraday/tickers/${ticker}`
    );
    if (res.ok) {
      const data = await res.json();
      return data.name;
    }
  } catch (e) {
    console.warn(`[Fugle] 無法獲取代號 ${ticker} 的名稱`);
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

  const tryFetchPrice = async (targetTicker) => {
    // 使用 v10 參數並強制指定語系
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
              result.regularMarketPreviousClose?.raw ||
              0,
            // 優先嘗試 Yahoo 的中文名稱欄位
            yahooName: result.longName || result.shortName,
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

  // 2. 名稱更新邏輯
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 名稱處理：台股優先使用 Fugle，非台股使用 Yahoo
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

      if (isTaiwan) {
        const fugleName = await getTaiwanStockName(cleanTicker);
        if (fugleName) {
          asset.fullName = fugleName;
        } else if (result.yahooName && hasChinese(result.yahooName)) {
          asset.fullName = result.yahooName;
        }
      } else {
        if (result.yahooName) asset.fullName = result.yahooName;
      }

      // 兜底方案：如果還是沒抓到中文，且原本也沒有正確名稱，才顯示代碼
      if (
        !asset.fullName ||
        asset.fullName === "---" ||
        !hasChinese(asset.fullName)
      ) {
        if (result.yahooName) asset.fullName = result.yahooName;
        else asset.fullName = ticker;
      }

      // --- 重要：更新資料後必須存檔並強制渲染 UI ---
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
  showToast("更新報價與名稱中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      await new Promise((r) => setTimeout(r, 600)); // 避免請求過快被封鎖
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(successCount > 0 ? `同步完成 (${successCount} 筆)` : "更新失敗");
}
