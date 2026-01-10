/**
 * api.js 修正版
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 更新代理列表：使用目前較穩定的代理服務
const PROXIES = [
  "https://corsproxy.io/?", // 優先使用
  "https://api.allorigins.win/get?url=", // 備用
  "https://api.codetabs.com/v1/proxy?quest=", // 備用
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 加上 modules=price 以確保能抓到 longName (中文名稱)
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${targetTicker}?modules=price&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        // 修正編碼與請求方式
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) continue;

        const rawData = await res.json();
        // 解析 AllOrigins 特有的 contents 封裝
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const priceObj = data.quoteSummary?.result?.[0]?.price;
        if (priceObj) {
          return {
            price:
              priceObj.regularMarketPrice?.raw || priceObj.regularMarketPrice,
            name: priceObj.longName || priceObj.shortName || priceObj.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 失敗`);
        continue;
      }
    }
    return null;
  };

  let result = null;
  if (isTaiwan && !ticker.includes(".")) {
    // 自動嘗試上市 (.TW) 與 上櫃 (.TWO)
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
      // 將延遲拉長到 1000ms，避開 Yahoo 的連線頻率限制
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("報價已同步");
}
