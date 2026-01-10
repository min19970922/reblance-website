/**
 * api.js
 * 職責：使用最穩定的 Yahoo v7 接口，同時抓取報價與中文名稱
 */
import { renderMainUI, showToast } from "./ui.js";
import { saveToStorage } from "./state.js";

// 線上環境最穩定的代理組合
const PROXIES = [
  "https://api.allorigins.win/get?url=",
  "https://corsproxy.io/?",
];

/**
 * 抓取單一標的的即時報價與中文名稱
 */
export async function fetchLivePrice(id, symbol, appState) {
  if (!symbol) return false;

  const icon = document.getElementById(`assetSync-${id}`);
  if (icon) icon.classList.add("fa-spin-fast", "text-rose-600");

  let ticker = symbol.trim().toUpperCase();
  const isTaiwan = /^\d{4,6}/.test(ticker);

  const tryFetch = async (targetTicker) => {
    // 改用 v7/quote 接口，這是目前獲取名稱與價格最穩定的組合
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${targetTicker}&lang=zh-Hant-TW&region=TW`;

    for (let proxy of PROXIES) {
      try {
        const finalUrl = proxy.includes("allorigins")
          ? proxy + encodeURIComponent(yahooUrl)
          : proxy + yahooUrl;

        const res = await fetch(finalUrl);
        if (!res.ok) continue;

        const rawData = await res.json();
        // 解析 AllOrigins 特有的 contents 封裝
        let data = proxy.includes("allorigins")
          ? JSON.parse(rawData.contents)
          : rawData;

        // v7 接口的數據結構
        const result = data.quoteResponse?.result?.[0];
        if (result) {
          return {
            price: result.regularMarketPrice,
            // 優先抓取 longName (完整中文名)，抓不到才用 shortName
            name: result.longName || result.shortName || result.symbol,
          };
        }
      } catch (e) {
        console.warn(`代理 ${proxy} 請求失敗`);
        continue;
      }
    }
    return null;
  };

  let result = null;
  if (isTaiwan && !ticker.includes(".")) {
    // 自動輪詢上市 (.TW) 與 上櫃 (.TWO)
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

      // 檢查回傳名稱是否含有中文，避免代碼覆蓋
      const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
      if (result.name && hasChinese(result.name)) {
        asset.fullName = result.name;
      } else if (!asset.fullName || asset.fullName === "---") {
        asset.fullName = ticker;
      }

      // 關鍵：更新資料後立即存檔並重新渲染 UI，確保下方文字同步改變
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
 * 批次同步所有標的
 */
export async function syncAllPrices(appState) {
  const mainSync = document.getElementById("syncIcon");
  if (mainSync) mainSync.classList.add("fa-spin-fast");
  showToast("正在獲取最新報價與中文名稱...");

  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  let successCount = 0;

  for (let asset of acc.assets) {
    if (asset.name) {
      const success = await fetchLivePrice(asset.id, asset.name, appState);
      if (success) successCount++;
      // 增加延遲防止被 Yahoo 封鎖 IP
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (mainSync) mainSync.classList.remove("fa-spin-fast");
  showToast(
    successCount > 0
      ? `成功更新 ${successCount} 筆標的`
      : "更新失敗，請檢查網路"
  );
}
