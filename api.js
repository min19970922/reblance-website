/**
 * api.js - 雙接口並行穩定版
 * 報價：Yahoo v8 Chart
 * 名稱：Yahoo v7 Quote
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.allorigins.win/get?url=",
];

/**
 * 透過 v7/quote 接口獲取名稱 (專責名稱)
 */
async function fetchNameV7(targetTicker) {
  const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;
  for (let proxy of PROXIES) {
    try {
      const finalUrl = proxy.includes("allorigins")
        ? proxy + encodeURIComponent(yahooUrl)
        : proxy + yahooUrl;
      const res = await fetch(finalUrl);
      if (!res.ok) continue;
      const json = await res.json();
      const data = proxy.includes("allorigins")
        ? JSON.parse(json.contents)
        : json;
      const result = data.quoteResponse?.result?.[0];
      if (result && (result.longName || result.shortName)) {
        return result.longName || result.shortName;
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
  // 支援債券格式如 00722B
  const isTWStyle = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetchPriceV8 = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;
    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;
        const res = await fetch(finalUrl);
        if (res.status === 404) return null; // 該代號不在這個市場
        if (!res.ok) continue;

        const json = await res.json();
        const data = proxy.includes("allorigins")
          ? JSON.parse(json.contents)
          : json;
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

  // 1. 執行報價抓取 (v8 優先)
  let result = null;
  if (isTWStyle && !ticker.includes(".")) {
    // 輪詢上市與上櫃
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

      // 更新價格後，立即執行第一次 UI 渲染，確保建議文字更新
      saveToStorage();
      renderMainUI(acc);

      // 3. 非同步抓取名稱 (v7 輔助)
      fetchNameV7(result.finalTicker).then((name) => {
        if (name && /[\u4e00-\u9fa5]/.test(name)) {
          asset.fullName = name;
          saveToStorage();
          renderMainUI(acc); // 名稱抓到後第二次渲染
        }
      });

      // 預設緩衝名稱
      if (!asset.fullName || asset.fullName === "---") asset.fullName = ticker;

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
  showToast("正在分流抓取報價 (v8) 與名稱 (v7)...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      await new Promise((r) => setTimeout(r, 800)); // 避免觸發 API 限制
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(successCount > 0 ? `同步完成 ${successCount} 筆` : "部分更新失敗");
}
