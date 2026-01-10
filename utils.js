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
 * utils.js - 終極跨裝置辨識版 (v4.9)
 * 解決手機誤抓標頭(17040)與數字斷裂問題
 */
import { safeNum } from "./state.js";
import { showToast } from "./ui.js";

/** 匯出 Excel */
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

/** 匯入 Excel */
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

/** 核心辨識引擎 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在智慧辨識 (v4.9)...");

  try {
    const worker = await Tesseract.createWorker("chi_tra+eng", 1, {
      workerPath:
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
      corePath:
        "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js",
    });

    // 針對表格進行優化：設定 PSM 模式為 6 (假設單一均勻文本塊)
    await worker.setParameters({ tessedit_pageseg_mode: "6" });

    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();

    // 1. 強制修復手機數字截斷 (合併數字間的異常空格)
    let cleanText = text.replace(/(\d)\s+(?=\d)/g, "$1");
    cleanText = cleanText.replace(/,/g, "");

    // 2. 關鍵區域鎖定：從最後一個「明細」關鍵字往後切，避開上方統計欄位的 17040
    const keyword = "明細";
    const lastIdx = cleanText.lastIndexOf(keyword);
    if (lastIdx === -1) {
      showToast("未偵測到資產明細區域");
      return;
    }
    const tableArea = cleanText.substring(lastIdx + keyword.length);

    const lines = tableArea.split("\n");
    const newAssets = [];

    lines.forEach((line) => {
      // 搜尋代碼規則：4-6位英數
      const tickerMatch = line.match(/([0-9]{4,5}[A-Z1]?)/);

      if (tickerMatch) {
        let finalCode = tickerMatch[1].toUpperCase();
        // L/1 校正
        if (finalCode.length === 6 && finalCode.endsWith("1"))
          finalCode = finalCode.slice(0, -1) + "L";

        const afterTicker = line.substring(
          tickerMatch.index + tickerMatch[1].length
        );

        /**
         * 股數精準定位邏輯：
         * 1. 尋找「交易類別」後的數字
         * 2. 若無類別，取扣除名稱數字後的「首個長數字」
         */
        const categoryMatch = afterTicker.match(
          /(?:現買|擔保品|融資|普通|庫存|現賣|融券|現|買)[^\d]*(\d{2,})/
        );

        let shares = 0;
        if (categoryMatch && categoryMatch[1]) {
          shares = parseInt(categoryMatch[1]);
        } else {
          // 備用：取大於 10 的第一個數字塊
          const allNums = afterTicker.match(/\b\d{2,}\b/g);
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
      showToast(`成功！發現 ${uniqueAssets.length} 筆資產`);
    } else {
      showToast("未能辨識有效標的");
    }
  } catch (err) {
    console.error("OCR 錯誤:", err);
    showToast("辨識引擎衝突");
  } finally {
    e.target.value = "";
  }
}
