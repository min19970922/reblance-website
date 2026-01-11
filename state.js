/**
 * state.js - 金融大師策略增強版 (V25)
 * 1. 支援目標總槓桿 (targetExp) 參數設定
 * 2. 支援動態偏離門檻 (絕對 Abs / 相對 Rel)
 * 3. 強化飽和度 (Saturation) 計算與維持率監控
 */

export const STORAGE_KEY = "REBALANCE_MASTER_PRO_V23";

/**
 * 初始帳戶範本
 */
export const initialAccountTemplate = (name = "新計畫") => ({
  id: "acc_" + Date.now(),
  name: name,
  currentCash: 0,
  totalDebt: 0,
  cashRatio: 0,
  targetExp: 1.0, // 新增：目標總槓桿，預設為 1.0x
  usdRate: 32.5,
  rebalanceAbs: 5, // 預設絕對門檻 5%
  rebalanceRel: 25, // 預設相對門檻 25%
  assets: [],
});

export let appState = {
  activeId: "acc_default",
  isSidebarCollapsed: false,
  accounts: [
    { ...initialAccountTemplate("主帳戶"), id: "acc_default", assets: [] },
  ],
};

/**
 * 安全數值轉換
 */
export function safeNum(val, def = 0) {
  if (val === null || val === undefined || val === "") return def;
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}

/**
 * 儲存與讀取邏輯
 */
export function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

export function loadFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.accounts) {
        // 確保舊資料升級時也能擁有新的 targetExp 屬性
        parsed.accounts.forEach((acc) => {
          if (acc.targetExp === undefined) acc.targetExp = 1.0;
        });
        Object.assign(appState, parsed);
        return true;
      }
    } catch (e) {
      console.error("存檔損毀:", e);
    }
  }
  return false;
}

/**
 * 計算帳戶即時數據：包含資產換算台幣、名目曝險、淨值與槓桿
 */
export function calculateAccountData(acc) {
  if (!acc) return null;
  let totalAssetBookValue = 0;
  let totalNominalExposure = 0;

  // 1. 計算所有實體資產的數據
  const assetsCalculated = acc.assets.map((asset) => {
    // 判定是否為台股 (代號為 4-6 位數字)
    const isTW = /^\d{4,6}[A-Z]?$/.test(
      (asset.name || "").trim().toUpperCase()
    );
    const rawPrice = safeNum(asset.price, 0);
    const priceTwd = isTW ? rawPrice : rawPrice * safeNum(acc.usdRate, 32.5);
    const bookValue = priceTwd * safeNum(asset.shares, 0);
    const nominalValue = bookValue * safeNum(asset.leverage, 1);

    totalAssetBookValue += bookValue;
    totalNominalExposure += nominalValue;

    return { ...asset, isTW, priceTwd, bookValue, nominalValue };
  });

  // 2. 計算帳戶核心指標
  const netValue =
    totalAssetBookValue + safeNum(acc.currentCash) - safeNum(acc.totalDebt);
  const totalLeverage = netValue > 0 ? totalNominalExposure / netValue : 0;

  // 3. 現金虛擬資產對象 (主要用於顯示，leverage 永遠為 1)
  const cashNetValue = safeNum(acc.currentCash) - safeNum(acc.totalDebt);
  const cashAsset = {
    id: "cash-row",
    name: "CASH",
    fullName: "可用現金 (扣除負債)",
    price: 1,
    priceTwd: 1,
    shares: cashNetValue,
    leverage: 1,
    targetRatio: safeNum(acc.cashRatio),
    nominalValue: cashNetValue,
    bookValue: cashNetValue,
    isTW: true,
  };

  return {
    assetsCalculated,
    cashAsset,
    netValue,
    totalNominalExposure,
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

/**
 * 再平衡核心邏輯：根據動態門檻判定是否觸發建議
 */
export function getRebalanceSuggestion(asset, acc, netValue) {
  const factor = safeNum(asset.leverage, 1);
  const currentPct =
    netValue > 0 ? (safeNum(asset.nominalValue) / netValue) * 100 : 0;
  const targetPct = safeNum(asset.targetRatio);

  // 1. 計算偏離程度
  const absDiff = Math.abs(currentPct - targetPct);
  const relDiff = targetPct !== 0 ? absDiff / targetPct : 0;

  // 2. 獲取使用者設定的動態門檻
  const tAbs = safeNum(acc.rebalanceAbs, 5);
  const tRel = safeNum(acc.rebalanceRel, 25) / 100;

  // 3. 計算差額金額 (以淨值為準)
  const targetNominal = netValue * (targetPct / 100);
  const diffNominal = targetNominal - safeNum(asset.nominalValue);

  // 4. 觸發判定：(偏離度達標) 且 (金額偏差 > 10,000)
  const isTriggered =
    (absDiff > tAbs || relDiff > tRel) && Math.abs(diffNominal) > 10000;

  // 5. 計算建議股數
  const priceTwd = safeNum(asset.priceTwd, 0);
  const diffShares =
    priceTwd * factor > 0 ? diffNominal / (priceTwd * factor) : 0;

  // 6. 計算飽和度 (0.0 ~ 1.0)
  const saturation = Math.min(1, Math.max(absDiff / tAbs, relDiff / tRel));

  return {
    currentPct,
    targetNominal,
    targetBookValue: targetNominal / factor,
    diffNominal,
    diffShares: Math.round(diffShares),
    isTriggered,
    absDiff,
    relDiff,
    saturation,
  };
}
