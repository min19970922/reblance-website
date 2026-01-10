/**
 * api.js - 雙接口穩定版
 * 報價：Yahoo v8 Chart (抓取報價最穩)
 * 名稱：Yahoo v7 Quote (中文全稱最準)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.allorigins.win/get?url=",
];

/**
 * 專職獲取中文名稱 (v7 接口)
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
 * 抓取報價 (v8 接口) 與 名稱 (v7 接口)
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
        if (res.status === 404) return null; // 此市場無此代號
        if (!res.ok) continue;

        const rawData = await res.json();
        let data = proxy.includes("allorigins")
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

  // 1. 優先執行報價抓取 (v8)
  let result = null;
  if (isTWStyle && !ticker.includes(".")) {
    // 依序嘗試上市 (.TW) 與 上櫃 (.TWO)
    result =
      (await tryFetchPriceV8(ticker + ".TW")) ||
      (await tryFetchPriceV8(ticker + ".TWO"));
  } else {
    result = await tryFetchPriceV8(ticker);
  }

  // 2. 更新價格並啟動非同步名稱抓取
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((as) => as.id === id);
    if (asset) {
      asset.price = result.price;

      // 價格更新後立刻存檔並重新計算建議文字
      saveToStorage();
      renderMainUI(acc);

      // 3. 非同步執行名稱抓取 (v7)
      fetchNameV7(result.finalTicker).then((name) => {
        if (name && /[\u4e00-\u9fa5]/.test(name)) {
          asset.fullName = name;
          saveToStorage();
          renderMainUI(acc); // 名稱抓到後第二次渲染，帶入中文名
        }
      });

      // 預設名稱 buffer
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
  showToast("分流抓取：報價(v8) & 名稱(v7)...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      await new Promise((r) => setTimeout(r, 800)); // 避免被 Proxy 封鎖
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(successCount > 0 ? `同步完成: ${successCount} 筆` : "更新失敗");
}
