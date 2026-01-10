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

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;

  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 強制指定語言為繁體中文，這能解決名稱非中文的問題
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const json = await res.json();

        // --- 關鍵修正：AllOrigins 的 JSONP 解析 ---
        let data;
        if (proxy.includes("allorigins")) {
          data = JSON.parse(json.contents);
        } else {
          data = json;
        }

        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return {
            price: parseFloat(meta.regularMarketPrice || meta.previousClose),
            // Yahoo v8 API 中文通常存在於 shortName
            name: meta.shortName || meta.longName || meta.symbol,
          };
        }
      } catch (e) {
        console.error("代理抓取失敗:", e);
        continue;
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

  if (result && !isNaN(result.price)) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 中文名稱鎖定邏輯
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      renderMainUI(acc); // 確保 UI 重新渲染
      if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
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
