/**
 * api.js
 * 職責：處理外部數據通訊、更換為 v8 穩定接口、解決 CORS 阻擋
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 使用您提供的參考代理列表，這是目前純前端最穩定的組合
const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

/**
 * 抓取單一資產報價 (換回 v8 chart 接口)
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;

  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 換回您參考版本中的 v8 chart URL
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const json = await res.json();

        // 關鍵：針對 AllOrigins 的 .contents 字串進行解析
        let data;
        if (proxy.includes("allorigins")) {
          data = JSON.parse(json.contents);
        } else {
          data = json;
        }

        const meta = data.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice || meta?.previousClose;

        if (price) {
          return {
            price: price,
            // 抓取 API 提供的名稱，若無則回傳代號
            name: meta?.shortName || meta?.symbol || targetTicker,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 嘗試失敗`);
        continue;
      }
    }
    return null;
  };

  let result = null;
  // 處理台股自動補完
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

      // 更新全名 (不再強制過濾中文，直接使用 API 回傳值)
      asset.fullName = result.name;

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
 * 批次同步所有資產報價
 */
export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("正在更新即時報價...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      // 呼叫單一更新
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 參考您提供的 450ms 延遲，保證不會被 Yahoo 封鎖
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(successCount > 0 ? "報價已同步" : "報價更新失敗，請檢查網路");
}
