/**
 * api.js (最終修正：更換代理與解析中文)
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

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
    // 升級為 v10 quoteSummary 以獲取繁體中文名稱
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy + encodeURIComponent(yahooUrl);
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData; // 解析 JSONP

        const priceObj = data.quoteSummary?.result?.[0]?.price;
        if (
          priceObj &&
          (priceObj.regularMarketPrice || priceObj.regularMarketPreviousClose)
        ) {
          return {
            price:
              priceObj.regularMarketPrice?.raw || priceObj.regularMarketPrice,
            name: priceObj.longName || priceObj.shortName || priceObj.symbol, // 優先擷取中文全名
          };
        }
      } catch (e) {
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
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name; // 只有抓到中文名稱才更新
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }
      saveToStorage();
      renderMainUI(acc);
      return true;
    }
  }
  if (icon) icon.classList.remove("fa-spin-fast", "text-rose-600");
  return false;
}

export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  mainSync?.classList.add("fa-spin-fast");
  showToast("更新報價中...");
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 1000)); // 延遲防止封鎖
    }
  }
  mainSync?.classList.remove("fa-spin-fast");
  showToast("報價已同步");
}
