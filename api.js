/**
 * api.js - 線上環境穩定版
 * 解決 401/500/CORS 與中文名稱問題
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 這裡只保留在線上環境最穩定的代理
const ALL_ORIGINS = "https://api.allorigins.win/get?url=";

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 使用 v8 接口搭配繁體中文參數
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${targetTicker}?interval=1m&range=1d&lang=zh-Hant-TW&region=TW`;

    try {
      // 這是繞過 CORS 最穩定的寫法：AllOrigins 的內容轉義模式
      const finalUrl = `${ALL_ORIGINS}${encodeURIComponent(
        yahooUrl
      )}&_=${Date.now()}`;

      const res = await fetch(finalUrl);
      if (!res.ok) return null;

      const wrapper = await res.json();
      // 關鍵：AllOrigins 回傳的是字串，必須解析
      const data = JSON.parse(wrapper.contents);

      const meta = data.chart?.result?.[0]?.meta;
      if (meta) {
        return {
          price: meta.regularMarketPrice || meta.previousClose,
          // 抓取 API 回傳的名稱
          name: meta.shortName || meta.longName || meta.symbol,
        };
      }
    } catch (e) {
      console.error("抓取失敗:", e);
    }
    return null;
  };

  let result = null;
  if (isTaiwan && !ticker.includes(".")) {
    // 自動輪詢上市櫃
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

      // 中文名稱處理
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
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
      // 拉長延遲到 1 秒，防止 GitHub Pages 網域被 Yahoo 暫時封鎖
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast("同步完成");
}
