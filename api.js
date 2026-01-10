/**
 * api.js
 * 修正：上櫃公司報價抓取失敗、確保中文名稱不被代號覆蓋
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://api.codetabs.com/v1/proxy?quest=", // 優先使用相對穩定的代理
  "https://corsproxy.io/?",
  "https://api.allorigins.win/get?url=",
];

export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}$/.test(ticker);

  const tryFetchData = async (targetTicker) => {
    // v7 quote API 是同時獲取價格與中文名稱的最佳平衡點
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 修正：更嚴謹地解析不同代理的回傳格式
        let data =
          proxy.includes("allorigins") && rawData.contents
            ? JSON.parse(rawData.contents)
            : rawData;

        const result = data.quoteResponse?.result?.[0];
        // 必須確保價格存在才算成功
        if (result && result.regularMarketPrice !== undefined) {
          return {
            price: result.regularMarketPrice,
            // 優先取 longName (中文全稱)
            name: result.longName || result.shortName,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 嘗試 ${targetTicker} 失敗`);
        continue;
      }
    }
    return null;
  };

  // 1. 執行報價抓取：台股自動輪詢上市(.TW)與上櫃(.TWO)
  let result = null;
  if (isTaiwan) {
    // 先測上市，失敗則測上櫃
    result = await tryFetchData(ticker + ".TW");
    if (!result) {
      result = await tryFetchData(ticker + ".TWO");
    }
  } else {
    result = await tryFetchData(ticker);
  }

  // 2. 更新數據
  if (result && result.price) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 檢查名稱是否包含中文
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      }
      // 修正：如果 API 沒給中文，且原本已經有中文名稱，就不應該用代號覆蓋它
      else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      saveToStorage();
      renderMainUI(acc); // 確保 UI 立即更新下方文字

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
  showToast("更新中，請稍候...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 增加延遲避免 Proxy 被暫時封鎖
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0 ? `成功更新 ${successCount} 筆` : "報價暫時無法取得"
  );
}
