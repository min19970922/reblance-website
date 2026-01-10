/**
 * api.js - 最終穩定版
 * 報價與名稱：Yahoo Finance v7 quote API
 * 傳輸機制：Proxy 輪播 (解决 GitHub Pages CORS 限制)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// Proxy 輪播列表
const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://corsproxy.io/?",
];

/**
 * 抓取單一資產報價與名稱 (v7 quote 專用)
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;

  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}$/.test(ticker);

  // 嘗試透過不同 Proxy 輪播抓取資料
  const tryFetchData = async (targetTicker) => {
    // v7 quote API：一次取得價格與中文名稱的最佳選擇
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 解析 AllOrigins 封裝的字串內容
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const result = data.quoteResponse?.result?.[0];
        if (result) {
          return {
            price: result.regularMarketPrice,
            // 優先取中文全名，其次取簡稱
            name: result.longName || result.shortName || result.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 請求失敗，嘗試下一個...`);
        continue;
      }
    }
    return null;
  };

  // 1. 執行報價與名稱抓取
  let result = null;
  if (isTaiwan) {
    // 台股自動嘗試 .TW 或 .TWO
    result =
      (await tryFetchData(ticker + ".TW")) ||
      (await tryFetchData(ticker + ".TWO"));
  } else {
    result = await tryFetchData(ticker);
  }

  // 2. 更新數據並即時連動 UI
  if (result && result.price) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 檢查名稱是否包含中文，防止被代號覆蓋
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      // 儲存並強制刷新 UI，解決下方文字不變的問題
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
 * 批次更新計畫內所有標的
 */
export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("正在利用 Proxy 輪播更新報價...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 增加延遲防止被 Yahoo 辨識為惡意爬蟲
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0 ? `更新完成: ${successCount} 筆` : "報價暫時無法取得"
  );
}
