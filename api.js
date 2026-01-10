/**
 * api.js - 終極穩定版
 * 報價：Yahoo v8 Chart (確保報價成功)
 * 名稱：Yahoo Search API (確保 100% 回傳中文名稱)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.allorigins.win/get?url=",
];

/**
 * 專門負責抓取中文名稱 (Search 接口對中文與債券最友善)
 */
async function fetchChineseName(ticker) {
  // 清除後綴進行搜尋，例如 2330.TW 搜尋 2330
  const cleanTicker = ticker.split(".")[0];
  const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${cleanTicker}&quotesCount=1&newsCount=0&lang=zh-Hant-TW&region=TW`;

  for (let proxy of PROXIES) {
    try {
      const finalUrl = proxy.includes("allorigins")
        ? proxy + encodeURIComponent(searchUrl)
        : proxy + searchUrl;
      const res = await fetch(finalUrl);
      if (!res.ok) continue;
      const json = await res.json();
      const data = proxy.includes("allorigins")
        ? JSON.parse(json.contents)
        : json;

      if (data.quotes && data.quotes.length > 0) {
        // 優先回傳 longname (例如：台積電)
        return data.quotes[0].longname || data.quotes[0].shortname;
      }
    } catch (e) {
      continue;
    }
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
  const isTWStyle = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetchPriceV8 = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;
    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;
        const res = await fetch(finalUrl);
        if (res.status === 404) return null;
        if (!res.ok) continue;

        const rawData = await res.json();
        const data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;
        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return {
            price: meta.regularMarketPrice || meta.previousClose,
            finalTicker: targetTicker,
          };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  // 1. 執行報價抓取 (v8)
  let result = null;
  if (isTWStyle && !ticker.includes(".")) {
    // 依序嘗試上市 (.TW) 與 上櫃 (.TWO)
    result =
      (await tryFetchPriceV8(ticker + ".TW")) ||
      (await tryFetchPriceV8(ticker + ".TWO"));
  } else {
    result = await tryFetchPriceV8(ticker);
  }

  // 2. 處理報價與名稱更新
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((as) => as.id === id);
    if (asset) {
      asset.price = result.price;

      // 價格更新後立刻渲染 UI，更新下方建議重算
      saveToStorage();
      renderMainUI(acc);

      // 3. 同步/非同步抓取中文名稱 (Search API)
      const cName = await fetchChineseName(result.finalTicker);
      if (cName) {
        asset.fullName = cName;
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      saveToStorage();
      renderMainUI(acc); // 名稱填入後再次更新畫面
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
  showToast("正在同步報價與中文名稱...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      await new Promise((r) => setTimeout(r, 1000)); // 延遲 1 秒確保代理不被封鎖
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0 ? `更新完成: ${successCount} 筆` : "更新失敗，請檢查網路"
  );
}
