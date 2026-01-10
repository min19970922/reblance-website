/**
 * state.js
 * 職責：管理資料結構、本地儲存 (LocalStorage) 以及所有投資核心計算邏輯
 */

// 1. 定義常數與預設狀態
export const STORAGE_KEY = "INVEST_REBAL_V19_TW_FIX";

export const initialAccountTemplate = (name = "新實戰計畫") => ({
  id: "acc_" + Date.now(),
  name: name,
  currentCash: 0,
  totalDebt: 500000,
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
      assets: [
        {
          id: 1,
          name: "2330",
          fullName: "台積電",
          price: 1000,
          shares: 100,
          targetRatio: 40,
          leverage: 1,
        },
        {
          id: 2,
          name: "0050",
          fullName: "元大台灣50",
          price: 180,
          shares: 1000,
          targetRatio: 30,
          leverage: 1,
        },
      ],
    },
  ],
};

// 3. 通用工具函式
export function safeNum(val, def = 0) {
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

// 5. 核心計算引擎 (The Engine)
// 此函式負責計算出所有顯示所需的數據，但不更動 DOM
export function calculateAccountData(acc) {
  if (!acc) return null;

  let totalNominalExposure = 0;
  let totalAssetBookValue = 0;

  // A. 處理各項資產基礎計算
  const assetsCalculated = acc.assets.map((asset) => {
    const isTW = /^\d{4,6}[A-Z]?$/.test(asset.name.trim().toUpperCase());
    const priceTwd = isTW
      ? safeNum(asset.price)
      : safeNum(asset.price) * safeNum(acc.usdRate);

    const bookValue = priceTwd * safeNum(asset.shares);
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

  // B. 帳戶總體數據
  const netValue =
    totalAssetBookValue + safeNum(acc.currentCash) - safeNum(acc.totalDebt);
  const totalLeverage = netValue > 0 ? totalNominalExposure / netValue : 0;
  const targetAssetRatioSum = acc.assets.reduce(
    (s, a) => s + safeNum(a.targetRatio),
    0
  );
  const targetTotalCombined = targetAssetRatioSum + safeNum(acc.cashRatio);

  // C. 質押維持率計算
  let maintenanceRatio = null;
  if (safeNum(acc.totalDebt) > 0) {
    maintenanceRatio = (totalAssetBookValue / safeNum(acc.totalDebt)) * 100;
  }

  return {
    assetsCalculated,
    netValue,
    totalNominalExposure,
    totalAssetBookValue,
    totalLeverage,
    targetTotalCombined,
    maintenanceRatio,
  };
}

// 6. 再平衡判斷邏輯
export function getRebalanceSuggestion(asset, acc, netValue) {
  const factor = safeNum(asset.leverage, 1);
  const currentPct = (asset.nominalValue / netValue) * 100;
  const targetPct = safeNum(asset.targetRatio);
  const targetNominal = netValue * (targetPct / 100);
  const targetBookValue = targetNominal / factor;

  // 觸發門檻判斷
  const absDiff = Math.abs(currentPct - targetPct);
  const relDiff = targetPct !== 0 ? absDiff / targetPct : 0;
  const thresholdAbs = safeNum(acc.rebalanceAbs, 5);
  const thresholdRel = safeNum(acc.rebalanceRel, 25) / 100;

  const isTriggered = absDiff > thresholdAbs || relDiff > thresholdRel;

  // 計算交易股數
  const diffNominal = targetNominal - asset.nominalValue;
  const diffCashImpact = diffNominal / factor;
  const diffSharesRaw =
    asset.priceTwd * factor > 0 ? diffNominal / (asset.priceTwd * factor) : 0;

  return {
    currentPct,
    targetNominal,
    targetBookValue,
    absDiff,
    relDiff,
    isTriggered,
    triggerProgress: Math.min(
      100,
      Math.max((absDiff / thresholdAbs) * 100, (relDiff / thresholdRel) * 100)
    ),
    diffNominal,
    diffCashImpact,
    diffShares: Math.round(diffSharesRaw),
  };
}
