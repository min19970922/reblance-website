/**
 * state.js - 金融大師策略增強版 (V24)
 * 1. 支援動態偏離門檻 (絕對 Abs / 相對 Rel)
 * 2. 新增 10,000 元台幣金額偏差觸發邏輯
 * 3. 強化飽和度 (Saturation) 計算，供 UI 呈現綠/黃/紅漸層
 */

export const STORAGE_KEY = "REBALANCE_MASTER_PRO_V23";

export const initialAccountTemplate = (name = "新計畫") => ({
  id: "acc_" + Date.now(),
  name: name,
  currentCash: 0,
  totalDebt: 0,
  cashRatio: 0,
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
/**
 * 計算帳戶即時數據：包含資產換算台幣、名目曝險、淨值與槓桿
 * 核心修復：整合現金為虛擬資產以支援再平衡邏輯
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

  // 3. 核心修復：建立「現金虛擬資產」對象
  // 現金的 nominalValue 即為 (現金 - 負債)，leverage 永遠為 1
  const cashNetValue = safeNum(acc.currentCash) - safeNum(acc.totalDebt);
  const cashAsset = {
    id: "cash-row",
    name: "CASH",
    fullName: "可用現金 (扣除負債)",
    price: 1,
    priceTwd: 1,
    shares: cashNetValue,
    leverage: 1,
    targetRatio: safeNum(acc.cashRatio), // 這裡對應 state.js 的初始屬性
    nominalValue: cashNetValue,
    bookValue: cashNetValue,
    isTW: true,
  };

  return {
    assetsCalculated,
    cashAsset, // 新增：回傳現金虛擬資產
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

  // 3. 計算差額金額
  const targetNominal = netValue * (targetPct / 100);
  const diffNominal = targetNominal - safeNum(asset.nominalValue);

  // 4. 觸發判定：(偏離度達標) 且 (金額偏差 > 10,000)
  const isTriggered =
    (absDiff > tAbs || relDiff > tRel) && Math.abs(diffNominal) > 10000;

  // 5. 計算建議股數
  const priceTwd = safeNum(asset.priceTwd, 0);
  const diffShares =
    priceTwd * factor > 0 ? diffNominal / (priceTwd * factor) : 0;

  // 6. 計算飽和度 (0.0 ~ 1.0)，用於 UI 判斷進度條顏色
  // 取「絕對偏離/門檻」與「相對偏離/門檻」的較大者
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
