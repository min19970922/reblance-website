/**
 * utils.js - 專業明細定位辨識版 (v3.5)
 */
import { safeNum } from "./state.js";
import { showToast } from "./ui.js";

/**
 * 匯出 Excel
 */
export function exportExcel(acc) {
  if (!acc) return;
  const data = [
    ["計畫名稱", acc.name],
    ["美金匯率", acc.usdRate],
    ["可用現金", acc.currentCash],
    ["負債總額", acc.totalDebt],
    ["絕對門檻", acc.rebalanceAbs],
    ["相對門檻", acc.rebalanceRel],
    [],
    ["代號", "標的全稱", "目前單價", "持有股數", "槓桿倍數", "目標權重%"],
  ];
  acc.assets.forEach((a) =>
    data.push([
      a.name,
      a.fullName || "",
      a.price,
      a.shares,
      a.leverage,
      a.targetRatio,
    ])
  );
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Portfolio");
  XLSX.writeFile(wb, `${acc.name}_財務快照.xlsx`);
}

/**
 * 匯入 Excel
 */
export function importExcel(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const ab = evt.target.result;
      const wb = XLSX.read(ab, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
        header: 1,
      });
      const newAcc = {
        id: "acc_" + Date.now(),
        name: rows[0][1].toString(),
        usdRate: safeNum(rows[1][1], 32.5),
        currentCash: safeNum(rows[2][1]),
        totalDebt: safeNum(rows[3][1]),
        rebalanceAbs: safeNum(rows[4][1], 5),
        rebalanceRel: safeNum(rows[5][1], 25),
        assets: [],
      };
      for (let i = 7; i < rows.length; i++) {
        const r = rows[i];
        if (r && r[0])
          newAcc.assets.push({
            id: Date.now() + i,
            name: r[0].toString().toUpperCase(), // 強制大寫
            fullName: r[1] || "",
            price: safeNum(r[2]),
            shares: safeNum(r[3]),
            leverage: safeNum(r[4], 1),
            targetRatio: safeNum(r[5]),
          });
      }
      onComplete(newAcc);
      showToast("匯入成功！");
    } catch (err) {
      showToast("Excel 解析失敗");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * 相機明細辨識邏輯
 * 規則：搜尋「明細」 -> 下一個是代碼 -> 跳過一格 -> 再下一個是股數
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在分析明細結構...");

  try {
    // 解決 WASM 報錯：使用較穩定的初始化方式
    const worker = await Tesseract.createWorker("chi_tra+eng");
    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();

    // 1. 文字清洗：移除逗號並按空格切分
    const tokens = text.replace(/,/g, "").split(/\s+/);
    const newAssets = [];

    // 2. 尋找「明細」錨點
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].includes("明細")) {
        // [i]明細 -> [i+1]代碼 -> [i+2]跳過項 -> [i+3]股數
        const potentialCode = tokens[i + 1];
        const potentialShares = tokens[i + 3];

        if (potentialCode && potentialCode.length >= 4) {
          const code = potentialCode.toUpperCase(); // 強制轉大寫
          const shares = parseInt(potentialShares);

          if (!isNaN(shares) && shares > 0) {
            newAssets.push({
              id: Date.now() + Math.random(),
              name: code,
              fullName: "---",
              price: 0,
              shares: shares,
              leverage: 1,
              targetRatio: 0,
            });
          }
        }
      }
    }

    if (newAssets.length > 0) {
      onComplete(newAssets);
      showToast(`成功辨識 ${newAssets.length} 筆明細資產`);
    } else {
      showToast("找不到明細格式，請確保照片清晰");
    }
  } catch (err) {
    console.error("OCR Error:", err);
    showToast("辨識過程出錯");
  } finally {
    e.target.value = "";
  }
}
