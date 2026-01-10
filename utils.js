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

    // 1. 定位關鍵字：只處理「明細」後方的資訊
    const keyword = "明細";
    const startIdx = text.indexOf(keyword);
    const relevantText =
      startIdx !== -1 ? text.substring(startIdx + keyword.length) : text;

    const lines = relevantText.split("\n");
    const newAssets = [];

    // 2. 逐行精準掃描
    lines.forEach((line) => {
      // 移除千分位逗號
      const cleanLine = line.replace(/,/g, "");

      // 台股代碼規則：4-5位數字，或5位數字+1位英數
      const tickerMatch = cleanLine.match(/([0-9]{4,5}[A-Z1]?)/);

      if (tickerMatch) {
        let finalCode = tickerMatch[1].toUpperCase();

        // 智慧校正：處理 00631L 被誤辨識為 006311 的情況
        if (finalCode.length === 6 && finalCode.endsWith("1")) {
          finalCode = finalCode.slice(0, -1) + "L";
        }

        // 股數辨識優化：尋找「中文字（類別）」後方的「第一個純數字」
        const afterTicker = cleanLine.substring(
          tickerMatch.index + tickerMatch[1].length
        );

        // 匹配模式：[中文字塊] + [可選括號] + [空白] + [數字]
        const shareMatch = afterTicker.match(/[\u4e00-\u9fa5]+\)?\s*(\d+)/);

        let shares = 0;
        if (shareMatch && shareMatch[1]) {
          shares = parseInt(shareMatch[1]);
        } else {
          // 備用方案：如果沒找到中文字區塊，則取該行代碼後的第一個大於 0 的整數
          const allNumbers = afterTicker.match(/\d+/g);
          if (allNumbers) {
            shares = parseInt(allNumbers[0]);
          }
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
