/**
 * api.js
 * 職責：使用穩定報價接口，並自動抓取 GitHub 社群維護的標的清單來帶入中文名稱
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 全域快取，避免重複抓取清單
let globalStockMap = null;

/**
 * 核心功能：從 GitHub 抓取最新的台股代碼對照表
 * 來源：finmind (或其他社群維護的開放資料)
 */
async function loadRemoteStockList() {
  if (globalStockMap) return globalStockMap;
  try {
    // 使用一個公開且穩定的台股清單 JSON (GitHub 來源不會有 CORS 限制)
    const res = await fetch(
      "https://raw.githubusercontent.com/AsunSama/taiwan-stock-list/master/stock_list.json"
    );
    if (res.ok) {
      const list = await res.json();
      // 將陣列轉為 Map 方便查表： { "2330": "台積電" }
      globalStockMap = {};
      list.forEach((item) => {
        globalStockMap[item.code] = item.name;
      });
      return globalStockMap;
    }
  } catch (e) {
    console.warn("無法載入遠端名稱清單，切換至備援模式");
  }
  return {};
}

const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://corsproxy.io/?",
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}[A-Z]?$/.test(cleanTicker);

  const tryFetchPrice = async (targetTicker) => {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;
    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const json = await res.json();
        // 修正：AllOrigins 必須解析 contents 欄位
        let data = proxy.includes("allorigins")
          ? JSON.parse(json.contents)
          : json;

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

  // 1. 同步執行：抓取報價
  let result = null;
  if (isTaiwan && !ticker.includes(".")) {
    result =
      (await tryFetchPrice(ticker + ".TW")) ||
      (await tryFetchPrice(ticker + ".TWO"));
  } else {
    result = await tryFetchPrice(ticker);
  }

  // 2. 自動名稱查表 (GitHub 來源)
  const nameMap = await loadRemoteStockList();

  // 3. 處理更新
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 優先從 GitHub 載入的清單中尋找名稱
      if (nameMap[cleanTicker]) {
        asset.fullName = nameMap[cleanTicker];
      }
      // 備援：如果原本沒有名稱才顯示代碼
      else if (!asset.fullName || asset.fullName === "---") {
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
  showToast("同步中，正在抓取最新標的清單...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  for (let asset of acc.assets) {
    if (asset.name) {
      await fetchLivePrice(asset.id, asset.name, appState);
      await new Promise((r) => setTimeout(r, 450));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("報價與名稱已同步");
}
