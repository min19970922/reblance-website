/**
 * api.js
 * 職責：處理外部數據通訊、更換為 v8 穩定接口、並自動抓取台股中文名稱
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 使用目前最穩定的代理組合，解決 GitHub Pages 的 CORS 問題
const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

/**
 * 輔助函式：透過 Fugle API 獲取台股中文名稱 (自動化，無需手動更新)
 * @param {string} ticker - 純數字代號 (如: 2330)
 */
async function getTaiwanStockName(ticker) {
  try {
    // 富果公用 API 只要輸入代號即可取得基礎資訊，無需 API Key
    const res = await fetch(
      `https://api.fugle.tw/marketdata/v1.0/stock/intraday/tickers/${ticker}`
    );
    if (res.ok) {
      const data = await res.json();
      return data.name; // 回傳如「台積電」
    }
  } catch (e) {
    console.warn("Fugle 名稱抓取失敗:", e);
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
  const cleanTicker = ticker.replace(".TW", "").replace(".TWO", "");
  const isTaiwan = /^\d{4,6}/.test(cleanTicker);

  const tryFetchPrice = async (targetTicker) => {
    // 使用穩定的 v8 chart 接口抓取價格
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const json = await res.json();
        let data = proxy.includes("allorigins")
          ? JSON.parse(json.contents)
          : json;

        const meta = data.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice || meta?.previousClose;

        if (price) {
          return { price };
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

  // 2. 非同步執行：如果是台股且目前沒名稱，去抓中文名稱
  if (isTaiwan) {
    getTaiwanStockName(cleanTicker).then((name) => {
      if (name) {
        const acc = appState.accounts.find((a) => a.id === appState.activeId);
        const asset = acc.assets.find((a) => a.id === id);
        if (asset) {
          asset.fullName = name;
          renderMainUI(acc); // 抓到名稱後再次刷新 UI
          saveToStorage();
        }
      }
    });
  }

  // 3. 處理報價結果
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 如果不是台股或抓不到名稱，暫時用代號
      if (!asset.fullName || asset.fullName === "---") {
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
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 延遲防止被 Yahoo 封鎖
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(successCount > 0 ? "報價已同步" : "報價更新失敗");
}
