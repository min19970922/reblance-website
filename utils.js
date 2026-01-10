/**
 * utils.js - 專業辨識修復版 (v4.0)
 * 1. 解決 WASM 初始化報錯：顯式指定 CDN 路徑
 * 2. 深度適配明細頁面：從混合文字中精準分離代碼與名稱
 * 3. 強制轉換代碼為大寫
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
            name: r[0].toString().toUpperCase(),
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

export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在初始化穩定版引擎...");

  try {
    // 強制指定穩定 Core 路徑，解決 wasm.js:31 報錯
    const worker = await Tesseract.createWorker("chi_tra+eng", 1, {
      workerPath:
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
      corePath:
        "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js",
      logger: (m) => console.log(m),
    });

    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();

    console.log("辨識成功內容:", text);

    // 1. 清理數據：移除逗號，將文字切分為 Token 陣列
    const tokens = text.replace(/,/g, "").split(/\s+/);
    const newAssets = [];

    // 2. 遍歷 Token 尋找潛在標的
    for (let i = 0; i < tokens.length; i++) {
      // 關鍵字檢查：包含「明細」或符合常見 OCR 誤認模式
      const token = tokens[i];
      if (token.includes("明細") || /BHfE|茹/.test(token)) {
        // 規則：[i]是按鈕, [i+1]通常是代碼 (如 00631L)
        const potentialCodeToken = tokens[i + 1];
        if (!potentialCodeToken) continue;

        // 從 Token 中分離出 4-6 位的英數組合 (適配代碼與名稱黏在一起的情況)
        const codeMatch = potentialCodeToken.match(/^([0-9A-Z]{4,6})/);
        if (codeMatch) {
          const code = codeMatch[1].toUpperCase();

          // 根據規則：搜尋到代碼後兩個欄位就是股數
          // [i+1]代碼, [i+2]跳過項, [i+3]股數
          const potentialShares = tokens[i + 3];
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
      showToast(`成功辨識 ${newAssets.length} 筆資產`);
    } else {
      showToast("未偵測到明細關鍵字或格式不符");
    }
  } catch (err) {
    console.error("OCR 致命錯誤:", err);
    showToast("辨識引擎衝突，請重新整理頁面");
  } finally {
    e.target.value = "";
  }
}
