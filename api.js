/**
 * api.js 修正版
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 更換代理列表：移除失效的 thingproxy，加入新的代理
const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=", // 新增備用代理
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 確保使用 v10 參數以取得中文名稱
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 只有 AllOrigins 需要解析 .contents
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const priceObj = data.quoteSummary?.result?.[0]?.price;
        if (
          priceObj &&
          (priceObj.regularMarketPrice || priceObj.regularMarketPreviousClose)
        ) {
          return {
            price:
              priceObj.regularMarketPrice?.raw || priceObj.regularMarketPrice,
            name: priceObj.longName || priceObj.shortName || priceObj.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 請求失敗`);
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

  if (result && result.price) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
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
  showToast("正在更新即時報價...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      // 增加延遲防止被封鎖
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("報價已同步");
}
