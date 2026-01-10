/**
 * api.js 完整修正版
 * 職責：處理外部數據通訊、CORS 代理切換、以及報價資料的解析
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 代理伺服器清單：corsproxy.io 目前在 GitHub Pages 環境下對 Yahoo 的相容性較佳
const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

/**
 * 抓取單一資產即時價格與中文名稱
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 使用 v10 quoteSummary 介面，並強制指定語系為繁體中文 (zh-Hant-TW)
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();

        // 處理 AllOrigins 代理特有的 contents 封裝結構
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        // 解析 v10 quoteSummary 的資料路徑
        const priceObj = data.quoteSummary?.result?.[0]?.price;
        if (
          priceObj &&
          (priceObj.regularMarketPrice || priceObj.regularMarketPreviousClose)
        ) {
          return {
            price:
              priceObj.regularMarketPrice?.raw ||
              priceObj.regularMarketPrice ||
              priceObj.regularMarketPreviousClose?.raw,
            // 優先擷取 longName (通常是完整的中文公司名稱)
            name: priceObj.longName || priceObj.shortName || priceObj.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 抓取 ${targetTicker} 失敗:`, e);
        continue;
      }
    }
    return null;
  };

  let result = null;
  // 台股自動嘗試 .TW (上市) 與 .TWO (上櫃)
  if (isTaiwan && !ticker.includes(".")) {
    result = await tryFetch(ticker + ".TW");
    if (!result) result = await tryFetch(ticker + ".TWO");
  } else {
    result = await tryFetch(ticker);
  }

  if (result && result.price) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 中文名稱保護判斷：僅當 API 回傳包含中文字元時才更新 fullName
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        // 若原本無名稱且 API 無中文，則暫時以代碼顯示
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
  showToast("更新報價中，請稍候...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 增加延遲 (1秒) 防止因請求過快被 Yahoo 阻擋
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0
      ? `同步完成 (成功: ${successCount} 筆)`
      : "同步失敗，請檢查網路連線"
  );
}
