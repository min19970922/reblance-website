/**
 * state.js 修正版
 * 職責：管理資料結構、本地儲存 (LocalStorage) 以及所有投資核心計算邏輯
 */

// 1. 定義常數與預設狀態
export const STORAGE_KEY = "INVEST_REBAL_V19_TW_FIX";

// 修正：將預設負債 totalDebt 從 500000 改為 0
export const initialAccountTemplate = (name = "新實戰計畫") => ({
  id: "acc_" + Date.now(),
  name: name,
  currentCash: 0,
  totalDebt: 0,
  cashRatio: 0,
  usdRate: 32.5,
  rebalanceAbs: 5,
  rebalanceRel: 25,
  assets: [],
});

// 2. 核心狀態物件
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

// 3. 強化型通用工具函式 (防止 NaN 的第一道防線)
export function safeNum(val, def = 0) {
  if (val === null || val === undefined || val === "") return def;
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}

// 4. 資料持久化邏輯
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
      console.error("解析 LocalStorage 失敗:", e);
    }
  }
  return false;
}

// 5. 核心計算引擎 (修正計算路徑，解決 NaN 問題)
export function calculateAccountData(acc) {
  if (!acc) return null;

  let totalNominalExposure = 0;
  let totalAssetBookValue = 0;

  const assetsCalculated = acc.assets.map((asset) => {
    const ticker = (asset.name || "").trim().toUpperCase();
    // 強化判定：數字開頭即視為台股
    const isTW = /^\d{4,6}/.test(ticker);

    const rawPrice = safeNum(asset.price, 0);
    const usdRate = safeNum(acc.usdRate, 32.5);

    // 台股不乘匯率，美股乘匯率
    const priceTwd = isTW ? rawPrice : rawPrice * usdRate;

    const bookValue = priceTwd * safeNum(asset.shares, 0);
    const nominalValue = bookValue * safeNum(asset.leverage, 1);

    totalAssetBookValue += bookValue;
    totalNominalExposure += nominalValue;

    return {
      ...asset,
      isTW,
      priceTwd,
      bookValue,
      nominalValue,
    };
  });

  const netValue =
    totalAssetBookValue + safeNum(acc.currentCash) - safeNum(acc.totalDebt);

  // 避免除以零產生 NaN
  const totalLeverage = netValue > 0 ? totalNominalExposure / netValue : 0;

  const targetAssetRatioSum = acc.assets.reduce(
    (s, a) => s + safeNum(a.targetRatio),
    0
  );
  const targetTotalCombined = targetAssetRatioSum + safeNum(acc.cashRatio);

  return {
    assetsCalculated,
    netValue,
    totalNominalExposure,
    totalAssetBookValue,
    totalLeverage,
    targetTotalCombined,
    maintenanceRatio:
      safeNum(acc.totalDebt) > 0
        ? (totalAssetBookValue / safeNum(acc.totalDebt)) * 100
        : 0,
  };
}

// 6. 再平衡判斷邏輯 (修正顯示建議門檻)
export function getRebalanceSuggestion(asset, acc, netValue) {
  const factor = safeNum(asset.leverage, 1);
  const currentPct =
    netValue > 0 ? (safeNum(asset.nominalValue) / netValue) * 100 : 0;
  const targetPct = safeNum(asset.targetRatio);
  const targetNominal = netValue * (targetPct / 100);
  const targetBookValue = targetNominal / factor;

  const absDiff = Math.abs(currentPct - targetPct);
  const thresholdAbs = safeNum(acc.rebalanceAbs, 5);
  const thresholdRel = safeNum(acc.rebalanceRel, 25) / 100;
  const relDiff = targetPct !== 0 ? absDiff / targetPct : 0;

  // 門檻判斷
  const isTriggered = absDiff > thresholdAbs || relDiff > thresholdRel;

  const diffNominal = targetNominal - safeNum(asset.nominalValue);
  const diffCashImpact = diffNominal / factor;
  const priceTwd = safeNum(asset.priceTwd, 0);
  const diffShares =
    priceTwd * factor > 0 ? diffNominal / (priceTwd * factor) : 0;

  return {
    currentPct,
    targetNominal,
    targetBookValue,
    absDiff,
    relDiff,
    isTriggered: true, // 強制開啟建議顯示，不再受門檻限制
    triggerProgress: Math.min(
      100,
      Math.max((absDiff / thresholdAbs) * 100, (relDiff / thresholdRel) * 100)
    ),
    diffNominal,
    diffCashImpact,
    diffShares: Math.round(diffShares),
  };
}
