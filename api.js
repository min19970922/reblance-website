/**
 * api.js 修正版
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 備援 Dictionary：如果 API 沒回傳中文，至少這些常用的要對
const BACKUP_NAMES = {
  2330: "台積電",
  "0050": "元大台灣50",
  "0056": "元大高股息",
  "006208": "富邦台50",
  1102: "亞泥",
};

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

  const tryFetch = async (targetTicker) => {
    // 使用 v8 接口，並加入語系參數嘗試誘導 Yahoo 回傳中文
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;
        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        const meta = data.chart?.result?.[0]?.meta;
        if (meta && (meta.regularMarketPrice || meta.previousClose)) {
          return {
            price: meta.regularMarketPrice || meta.previousClose,
            // 嘗試從 meta 中抓取 shortName
            name: meta.shortName || meta.longName,
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

      // --- 名稱邏輯修正 ---
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

      if (result.name && hasChinese(result.name)) {
        // 如果 API 回傳的有中文，直接用
        asset.fullName = result.name;
      } else if (BACKUP_NAMES[cleanTicker]) {
        // 如果 API 沒中文但 Dictionary 有，用 Dictionary
        asset.fullName = BACKUP_NAMES[cleanTicker];
      } else {
        // 都沒有就維持原樣或代號
        if (!asset.fullName) asset.fullName = ticker;
      }

      saveToStorage();
      renderMainUI(acc); // 確保觸發 UI 更新
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
      await new Promise((r) => setTimeout(r, 600)); // 避免請求太快
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("更新完成");
}
