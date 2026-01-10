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

  showToast("正在辨識資產明細...");

  try {
    const worker = await Tesseract.createWorker("chi_tra+eng", 1, {
      workerPath:
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
      corePath:
        "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js",
    });

    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();

    // 1. 預處理：移除千分位逗號，統一空白
    const cleanText = text.replace(/,/g, "");
    const tokens = cleanText.split(/\s+/);
    const newAssets = [];

    // 2. 智慧掃描：尋找 [代碼] + [跳過數個] + [股數] 的模式
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // 判斷是否為台股/美股代碼 (4-6位數字或字母，且排除純日期)
      const isTicker = /^[0-9A-Z]{4,6}$/.test(token) && !/\d{8}/.test(token);

      if (isTicker || token.includes("明細")) {
        let code = isTicker ? token : tokens[i + 1];
        if (!code) continue;

        // 如果是從「明細」關鍵字找起，代碼通常在後面
        const potentialCode = code.match(/^[0-9A-Z]{4,6}/);
        if (!potentialCode) continue;

        const finalCode = potentialCode[0].toUpperCase();

        // 股數偵測邏輯：在代碼附近的 5 個 token 內尋找大於 0 的純整數
        for (let j = 1; j <= 5; j++) {
          const nextVal = parseInt(tokens[i + j]);
          if (!isNaN(nextVal) && nextVal > 0 && nextVal % 1 === 0) {
            newAssets.push({
              id: Date.now() + Math.random(),
              name: finalCode,
              fullName: "---",
              price: 0,
              shares: nextVal,
              leverage: 1,
              targetRatio: 0,
            });
            i += j; // 成功找到後跳過已處理的 token
            break;
          }
        }
      }
    }

    if (newAssets.length > 0) {
      // 簡單去重
      const uniqueAssets = Array.from(
        new Map(newAssets.map((a) => [a.name, a])).values()
      );
      onComplete(uniqueAssets);
      showToast(`辨識成功！發現 ${uniqueAssets.length} 筆標的`);
    } else {
      showToast("未能辨識有效標的，請嘗試更清晰的照片");
    }
  } catch (err) {
    console.error(err);
    showToast("辨識發生錯誤");
  } finally {
    e.target.value = "";
  }
}
