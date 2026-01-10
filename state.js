/**
 * state.js
 * 職責：管理資料結構、本地儲存 (LocalStorage) 以及所有投資核心計算邏輯
 * 修正版：解決 NaN 錯誤與數值計算斷層
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

// 3. 強化型通用工具函式 (防止 NaN 的第一道防線)
export function safeNum(val, def = 0) {
  if (val === null || val === undefined) return def;
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

  // A. 處理各項資產基礎計算
  const assetsCalculated = acc.assets.map((asset) => {
    // 強化判定：確保 asset.name 存在
    const ticker = (asset.name || "").trim().toUpperCase();
    const isTW = /^\d{4,6}/.test(ticker);

    // 確保價格、匯率為有效數字
    const rawPrice = safeNum(asset.price, 0);
    const usdRate = safeNum(acc.usdRate, 32.5);

    // 台股不乘匯率，其餘（美股）乘匯率
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
      nominalValue, // 確保此處產出的為數字型態
    };
  });

  // B. 帳戶總體數據 (增加保護邏輯)
  const netValue =
    totalAssetBookValue + safeNum(acc.currentCash) - safeNum(acc.totalDebt);

  // 避免除以零產生 NaN
  const totalLeverage = netValue > 0 ? totalNominalExposure / netValue : 0;

  const targetAssetRatioSum = acc.assets.reduce(
    (s, a) => s + safeNum(a.targetRatio),
    0
  );
  const targetTotalCombined = targetAssetRatioSum + safeNum(acc.cashRatio);

  // C. 質押維持率計算
  let maintenanceRatio = 0;
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

// 6. 再平衡判斷邏輯 (修正除以零與 undefined 引用)
export function getRebalanceSuggestion(asset, acc, netValue) {
  const factor = safeNum(asset.leverage, 1);
  const currentPct =
    netValue > 0 ? (safeNum(asset.nominalValue) / netValue) * 100 : 0;
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
  const diffNominal = targetNominal - safeNum(asset.nominalValue);
  const diffCashImpact = diffNominal / factor;

  // 確保 priceTwd 有效
  const priceTwd = safeNum(asset.priceTwd, 0);
  const diffSharesRaw =
    priceTwd * factor > 0 ? diffNominal / (priceTwd * factor) : 0;

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
