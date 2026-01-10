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

/**
 * utils.js - 辨識邏輯最終修正版
 */
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

    // 1. 數據預處理：解決手機辨識問題
    // 合併被拆散的數字 (例如 "7 000" -> "7000")
    let processedText = text.replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
    // 移除千分位逗號
    processedText = processedText.replace(/,/g, "");

    // 2. 定位「明細」起始點
    const startIdx = processedText.indexOf("明細");
    const relevantText =
      startIdx !== -1 ? processedText.substring(startIdx) : processedText;

    const lines = relevantText.split("\n");
    const newAssets = [];

    // 3. 逐行分離識別
    lines.forEach((line) => {
      // 搜尋代碼 (優先尋找「明細」後方的代碼)
      const tickerMatch = line.match(/(?:明細)?\s*([0-9]{4,5}[A-Z1]?)/);

      if (tickerMatch) {
        let finalCode = tickerMatch[1].toUpperCase();
        // L/1 校正
        if (finalCode.length === 6 && finalCode.endsWith("1"))
          finalCode = finalCode.slice(0, -1) + "L";

        const afterTicker = line.substring(
          tickerMatch.index + tickerMatch[0].length
        );

        /**
         * 股數精準定位：
         * 跳過名稱(如 50 正 2)，尋找「交易類別關鍵字」後的第一組數字。
         * 如果沒抓到類別，則抓取代碼後第一個「長度 >= 2」的數字塊（避開正 2 的 2）。
         */
        const categoryMatch = afterTicker.match(
          /(?:現買|擔保品|融資|普通|庫存|現賣|融券|現|買)[^\d]*(\d{1,})/
        );

        let shares = 0;
        if (categoryMatch && categoryMatch[1]) {
          shares = parseInt(categoryMatch[1]);
        } else {
          // 備用：抓取扣除名稱後的首個有效整數
          const allNums = afterTicker.match(/\d{2,}/g); // 至少兩位數
          if (allNums) shares = parseInt(allNums[0]);
        }

        if (shares > 0) {
          newAssets.push({
            id: Date.now() + Math.random(),
            name: finalCode,
            fullName: "---",
            price: 0,
            shares: shares,
            leverage: 1,
            targetRatio: 0,
          });
        }
      }
    });

    if (newAssets.length > 0) {
      const uniqueAssets = Array.from(
        new Map(newAssets.map((a) => [a.name, a])).values()
      );
      onComplete(uniqueAssets);
      showToast(`辨識成功！發現 ${uniqueAssets.length} 筆資產`);
    } else {
      showToast("未能辨識有效標的，請嘗試更清晰的照片");
    }
  } catch (err) {
    console.error("OCR 錯誤:", err);
    showToast("辨識發生錯誤");
  } finally {
    e.target.value = "";
  }
}
