/**
 * api.js - 線上環境終極穩定版
 * 解決 CORS 阻擋、401 錯誤與中文名稱消失問題
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 全域名稱地圖快取
let stockNameMap = null;

/**
 * 核心：自動抓取 GitHub 社群維護的台股清單 (無 CORS 限制)
 */
async function loadTaiwanStockNames() {
  if (stockNameMap) return stockNameMap;
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/AsunSama/taiwan-stock-list/master/stock_list.json"
    );
    if (res.ok) {
      const list = await res.json();
      stockNameMap = {};
      list.forEach((item) => {
        stockNameMap[item.code] = item.name;
      });
      return stockNameMap;
    }
  } catch (e) {
    console.warn("無法加載遠端名稱清單");
  }
  return {};
}

// 代理列表：僅保留 GitHub Pages 上較穩定的來源
const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://api.codetabs.com/v1/proxy?quest=",
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}/.test(cleanTicker);

  const tryFetchPrice = async (targetTicker) => {
    // 報價回歸 v8 chart，這是目前最穩定的報價接口
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 關鍵：處理 AllOrigins 的 JSONP 解析
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const meta = data.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          return { price: meta.regularMarketPrice };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  // 1. 抓取報價
  let result =
    isTaiwan && !ticker.includes(".")
      ? (await tryFetchPrice(ticker + ".TW")) ||
        (await tryFetchPrice(ticker + ".TWO"))
      : await tryFetchPrice(ticker);

  // 2. 自動帶入中文名稱 (GitHub 來源)
  if (isTaiwan) {
    const nameMap = await loadTaiwanStockNames();
    if (nameMap[cleanTicker]) {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      const asset = acc.assets.find((a) => a.id === id);
      if (asset) asset.fullName = nameMap[cleanTicker];
    }
  }

  // 3. 更新與渲染
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;
      if (!asset.fullName || asset.fullName === "---") asset.fullName = ticker;

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
  mainSync?.classList.add("fa-spin-fast");
  showToast("同步中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  mainSync?.classList.remove("fa-spin-fast");
  showToast("報價與名稱已同步");
}
