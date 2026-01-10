import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 使用您驗證過的穩定代理組合
const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://corsproxy.io/?",
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 換回您提供的穩定 v8/chart 網址格式
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const json = await res.json();

        // 關鍵：針對 GitHub Pages 上的 AllOrigins 進行 JSON 解析
        let data = proxy.includes("allorigins")
          ? JSON.parse(json.contents)
          : json;

        const meta = data.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice || meta?.previousClose;

        if (price) {
          return {
            price: price,
            name: meta?.shortName || meta?.symbol || targetTicker,
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
      asset.fullName = result.name; // 直接套用 API 名稱

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
      // 維持 450ms 延遲以保證穩定性
      await new Promise((r) => setTimeout(r, 450));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("報價已同步");
}
