/**
 * state.js (V21 最終修正版)
 */
// 更新版本號為 V21，這會強制清除瀏覽器中舊有的 500,000 負債紀錄
export const STORAGE_KEY = "INVEST_REBAL_V21_CLEAN_FINAL";

export const initialAccountTemplate = (name = "新實戰計畫") => ({
  id: "acc_" + Date.now(),
  name: name,
  currentCash: 0,
  totalDebt: 0, // 預設負債改為 0
  cashRatio: 0,
  usdRate: 32.5,
  rebalanceAbs: 5,
  rebalanceRel: 25,
  assets: [],
});

export let appState = {
  activeId: "acc_default",
  isSidebarCollapsed: false,
  accounts: [
    {
      ...initialAccountTemplate("實戰配置"),
      id: "acc_default",
      assets: [],
    },
  ],
};

// 強化防錯：處理空字串，防止正在輸入時產生 NaN
export function safeNum(val, def = 0) {
  if (val === null || val === undefined || val === "") return def;
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}

export function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

export function loadFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.accounts) {
        appState = parsed;
        return true;
      }
    } catch (e) {
      console.error("載入存檔失敗:", e);
    }
  }
  return false;
}

export function calculateAccountData(acc) {
  if (!acc) return null;
  let totalNominalExposure = 0;
  let totalAssetBookValue = 0;

  const assetsCalculated = acc.assets.map((asset) => {
    const ticker = (asset.name || "").trim().toUpperCase();
    const isTW = /^\d{4,6}/.test(ticker);
    const rawPrice = safeNum(asset.price, 0);
    const priceTwd = isTW ? rawPrice : rawPrice * safeNum(acc.usdRate, 32.5);
    const bookValue = priceTwd * safeNum(asset.shares, 0);
    const nominalValue = bookValue * safeNum(asset.leverage, 1);

    totalAssetBookValue += bookValue;
    totalNominalExposure += nominalValue;

    return { ...asset, isTW, priceTwd, bookValue, nominalValue };
  });

  const netValue =
    totalAssetBookValue + safeNum(acc.currentCash) - safeNum(acc.totalDebt);
  const totalLeverage = netValue > 0 ? totalNominalExposure / netValue : 0;

  return {
    assetsCalculated,
    netValue,
    totalNominalExposure,
    totalAssetBookValue,
    totalLeverage,
    maintenanceRatio:
      safeNum(acc.totalDebt) > 0
        ? (totalAssetBookValue / safeNum(acc.totalDebt)) * 100
        : 0,
    targetTotalCombined:
      acc.assets.reduce((s, a) => s + safeNum(a.targetRatio), 0) +
      safeNum(acc.cashRatio),
  };
}

export function getRebalanceSuggestion(asset, acc, netValue) {
  const factor = safeNum(asset.leverage, 1);
  const currentPct =
    netValue > 0 ? (safeNum(asset.nominalValue) / netValue) * 100 : 0;
  const targetPct = safeNum(asset.targetRatio);
  const targetNominal = netValue * (targetPct / 100);
  const diffNominal = targetNominal - safeNum(asset.nominalValue);
  const priceTwd = safeNum(asset.priceTwd, 0);
  const diffShares =
    priceTwd * factor > 0 ? diffNominal / (priceTwd * factor) : 0;

  return {
    currentPct,
    targetNominal,
    targetBookValue: targetNominal / factor,
    diffNominal,
    diffShares: Math.round(diffShares),
    isTriggered: true, // 修正：即使偏差小也顯示建議，解決輸入位數過大的 Bug
    absDiff: Math.abs(currentPct - targetPct),
  };
}
