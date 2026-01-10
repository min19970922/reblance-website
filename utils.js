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

  showToast("正在智慧辨識 (v5.0)...");

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

    // 1. 過濾統計區：只取最後一個「明細」之後的內容
    const lastKeywordIdx = text.lastIndexOf("明細");
    const targetText =
      lastKeywordIdx !== -1 ? text.substring(lastKeywordIdx) : text;

    const lines = targetText.split("\n");
    const newAssets = [];

    lines.forEach((line) => {
      // 移除逗號
      let cleanLine = line.replace(/,/g, "");
      // 嘗試找代碼：4-5位數字，或5位數字+1位英數
      const tickerMatch = cleanLine.match(/([0-9]{4,5}[A-Z1]?)/);

      if (tickerMatch) {
        let ticker = tickerMatch[1].toUpperCase();
        // L/1 校正：如果長度為 6 且結尾是 1，通常是槓桿標的
        if (ticker.length === 6 && ticker.endsWith("1"))
          ticker = ticker.slice(0, -1) + "L";

        // 截取該行代碼後的文字，並嘗試合併被拆散的股數 (如 7 000)
        const afterTicker = cleanLine.substring(
          tickerMatch.index + tickerMatch[1].length
        );
        const joinedLine = afterTicker.replace(/(\d)\s+(?=\d)/g, "$1");

        // 股數定位：鎖定「交易類別」後的長數字
        const categoryMatch = joinedLine.match(
          /(?:現買|擔保品|融資|普通|庫存|現賣|融券|現|買)[^\d]*(\d{2,})/
        );

        let shares = 0;
        if (categoryMatch) {
          shares = parseInt(categoryMatch[1]);
        } else {
          // 備用：取該行除了標的名稱(50, 2)以外的第一個長數字
          const allNums = joinedLine.match(/\b\d{2,}\b/g);
          if (allNums) shares = parseInt(allNums[0]);
        }

        if (shares > 0) {
          newAssets.push({
            id: Date.now() + Math.random(),
            name: ticker,
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
      showToast(`成功辨識 ${uniqueAssets.length} 筆資產`);
    } else {
      showToast("未能辨識有效標的，請靠近拍攝");
    }
  } catch (err) {
    console.error("OCR 錯誤:", err);
    showToast("辨識引擎衝突，請重新整理");
  } finally {
    e.target.value = "";
  }
}
