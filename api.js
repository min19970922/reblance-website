/**
 * api.js
 * 職責：處理外部數據通訊、CORS 代理切換、以及報價資料的解析
 */
/**
 * api.js 修正版
 */
import { renderMainUI, showToast } from "./ui.js";

const PROXIES = [
  "https://api.allorigins.win/get?url=", // 建議將此放第一位，GitHub Pages 環境下較穩
  "https://corsproxy.io/?",
];

// api.js
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 改用 v10/quoteSummary，這是目前抓取繁體中文最穩定的路徑
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const json = await res.json();
        let data = proxy.includes("allorigins")
          ? JSON.parse(json.contents)
          : json;

        // v10 的資料結構與 v8 不同，需重新對齊
        const result = data.quoteSummary?.result?.[0]?.price;
        if (result && result.regularMarketPrice) {
          return {
            price: result.regularMarketPrice.raw || result.regularMarketPrice,
            // 這裡優先取 longName，台股通常會顯示「台積電」
            name: result.longName || result.shortName || result.symbol,
          };
        }
      } catch (e) {
        console.error("抓取失敗:", e);
      }
    }
    return null;
  };

  let result = null;
  if (isTaiwan && !ticker.includes(".")) {
    result =
      (await tryFetch(ticker + ".TW")) || (await tryFetch(ticker + ".TWO"));
  } else {
    result = await tryFetch(ticker);
  }

  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (hasChinese(result.name)) {
        asset.fullName = result.name;
      }

      // 關鍵修正：重新整理前先儲存 state
      import("./state.js").then((m) => m.saveToStorage());
      renderMainUI(acc);
      return true;
    }
  }
  if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
  return false;
}
// syncAllPrices 保持原樣即可，但確保它傳遞正確的 appState

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
