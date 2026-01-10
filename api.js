/**
 * api.js - 最終穩定輪播版
 * 報價與名稱：Yahoo Finance v7 quote API
 * 傳輸機制：Proxy 輪播 (解決 GitHub Pages 500/401/CORS 限制)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// Proxy 輪播清單：若其中一個失效，程式會自動嘗試下一個
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
  // 判定是否為台股（純數字代號）
  const isTaiwan = /^\d{4,6}$/.test(ticker);

  // 嘗試透過不同 Proxy 輪播抓取資料的內部函式
  const tryFetchData = async (targetTicker) => {
    // v7 quote API：一次取得價格與繁體中文名稱的最佳選擇
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) {
          console.warn(`代理 ${proxy} 回傳錯誤碼: ${res.status}`);
          continue;
        }

        const rawData = await res.json();
        // 關鍵修正：解析 AllOrigins 封裝的內容，其他代理則直接回傳 JSON
        let data =
          proxy.includes("allorigins") && rawData.contents
            ? JSON.parse(rawData.contents)
            : rawData;

        const result = data.quoteResponse?.result?.[0];
        if (result && result.regularMarketPrice !== undefined) {
          return {
            price: result.regularMarketPrice,
            // 優先取中文全名 (longName)
            name: result.longName || result.shortName || result.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 請求異常，嘗試下一個...`);
        continue;
      }
    }
    return null;
  };

  // 1. 執行報價與名稱抓取
  let result = null;
  if (isTaiwan) {
    // 台股自動輪詢上市 (.TW) 或 上櫃 (.TWO)
    result =
      (await tryFetchData(ticker + ".TW")) ||
      (await tryFetchData(ticker + ".TWO"));
  } else {
    result = await tryFetchData(ticker);
  }

  // 2. 更新數據並同步更新 UI
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

      // 儲存並強制刷新 UI，解決下方建議文字不變的問題
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
  showToast("正在利用代理輪播更新報價與名稱...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 增加延遲防止被 Yahoo 辨識為惡意爬蟲或觸發 Proxy 頻率限制
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0
      ? `更新完成: ${successCount} 筆成功`
      : "報價更新失敗，請稍後再試"
  );
}
