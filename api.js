/**
 * api.js 最終修正版
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 移除失效的 corsproxy.io，使用 allorigins 作為主要代理
const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://thingproxy.freeboard.io/fetch/",
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 確保使用 v10 API 並包含 modules=price 以取得中文全名
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 解析 AllOrigins 的 JSON 封裝結構
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const priceObj = data.quoteSummary?.result?.[0]?.price;
        if (
          priceObj &&
          (priceObj.regularMarketPrice || priceObj.regularMarketPreviousClose)
        ) {
          return {
            // 抓取原始數值，避免型別錯誤
            price:
              priceObj.regularMarketPrice?.raw || priceObj.regularMarketPrice,
            // 優先擷取繁體中文全名 (longName)
            name: priceObj.longName || priceObj.shortName || priceObj.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理請求失敗`);
        continue;
      }
    }
    return null;
  };

  let result =
    isTaiwan && !ticker.includes(".")
      ? (await tryFetch(ticker + ".TW")) || (await tryFetch(ticker + ".TWO"))
      : await tryFetch(ticker);

  if (result && result.price) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      // 僅在 API 回傳包含中文時更新 fullName
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
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

export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("更新報價中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      // 增加延遲防止頻繁請求被阻擋
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("更新完成");
}
