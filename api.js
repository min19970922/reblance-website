/**
 * api.js 修正版
 * 1. 強化 00722B 等債券與上櫃標的 (.TWO) 的偵測
 * 2. 修正 Proxy 解析錯誤與失效切換邏輯
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

const PROXIES = [
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
  "https://api.allorigins.win/get?url=",
];

/**
 * 抓取單一資產報價與名稱
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;
  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  // 判定是否為台股/台資產 (純數字或數字+字母組合，如 00722B)
  const isTaiwanStyle = /^\d{4,6}[A-Z]?$/.test(ticker);

  const tryFetchData = async (targetTicker) => {
    // 使用 v7 quote API 同時抓取價格與名稱，這是最穩定的方式
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        // 如果是 404 則代表代號後綴不對（例如上市誤用上櫃），直接跳出換下一個後綴
        if (res.status === 404) return null;
        if (!res.ok) continue;

        const rawData = await res.json();
        let data =
          proxy.includes("allorigins") && rawData.contents
            ? JSON.parse(rawData.contents)
            : rawData;

        const result = data.quoteResponse?.result?.[0];
        if (result && result.regularMarketPrice !== undefined) {
          return {
            price: result.regularMarketPrice,
            name: result.longName || result.shortName || result.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理請求異常: ${proxy}`);
        continue;
      }
    }
    return null;
  };

  // 1. 執行報價抓取：針對台股資產嘗試 .TW 與 .TWO
  let result = null;
  if (isTaiwanStyle && !ticker.includes(".")) {
    // 優先嘗試上市 (.TW)
    result = await tryFetchData(ticker + ".TW");
    // 若失敗 (包含 00722B 這種可能是上櫃或債券)，嘗試上櫃 (.TWO)
    if (!result) {
      result = await tryFetchData(ticker + ".TWO");
    }
  } else {
    // 美股或已帶後綴的標的
    result = await tryFetchData(ticker);
  }

  // 2. 處理更新結果
  if (result) {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    const asset = acc.assets.find((a) => a.id === id);
    if (asset) {
      asset.price = result.price;

      // 檢查名稱是否有中文，若有則更新，若無則保留舊有名稱
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      saveToStorage();
      renderMainUI(acc); // 確保觸發渲染，更新建議文字
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
  showToast("更新報價與名稱中...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 延遲增加到 1 秒，減少 Proxy 被阻擋機率
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0 ? `成功更新 ${successCount} 筆` : "報價暫時無法取得"
  );
}
