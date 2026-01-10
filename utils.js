/**
 * utils.js - 終極跨裝置相容版 (v5.3)
 * 1. 徹底過濾標頭噪音 (17040 總股數)
 * 2. 智慧排除標的名稱數字 (如 50正2)
 * 3. 解決手機 7 000 斷裂與辨識位移
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

  if (window.showToast) window.showToast("正在深度智慧辨識 (v6.2)...");

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

    const rawLines = text.split("\n");
    const assets = [];

    for (let line of rawLines) {
      // ⚡ 強力過濾雜訊：忽略統計、帳號與總額行
      if (
        line.includes("總股數") ||
        line.includes("總成本") ||
        line.includes("帳號") ||
        line.includes("總額")
      )
        continue;

      let clean = line.replace(/,/g, "");

      /**
       * 🎯 股票代碼提取 (支援 4-6 位)
       * 使用更寬鬆的匹配，確保 6811 或 00631L 都能被抓到
       */
      const tickerMatch = clean.match(/(\d{4,5}[A-Z1]?)/);
      if (!tickerMatch) continue;

      let ticker = tickerMatch[1].toUpperCase();

      // 💡 L/1 自動校正邏輯
      if (ticker.length === 6 && ticker.endsWith("1")) {
        ticker = ticker.slice(0, -1) + "L";
      }

      // 取得代碼後的字串進行局部處理
      const after = clean.substring(tickerMatch.index + tickerMatch[1].length);

      // 修正手機千分位斷裂 (例如 "7 000" -> "7000")
      const fixed = after.replace(/(\b\d{1,3})\s+(\d{3})(?!\d)/g, "$1$2");

      /**
       * 🎯 股數抽取邏輯
       * 鎖定交易類別（現買、擔保品等）後的數字塊
       */
      const categoryMatch = fixed.match(
        /(?:現買|擔保品|融資|庫存|普通|現賣|現股|現|買|賣)[^\d]*?(\d{2,7})/
      );

      let shares = 0;
      if (categoryMatch) {
        shares = parseInt(categoryMatch[1]);
      } else {
        // 備援方案：抓取該行扣除代碼後第一個大於 10 且「不含小數點」的純整數
        const nums = fixed.match(/\b\d{2,7}\b/g);
        if (nums) {
          const pick = nums.find((n) => parseInt(n) > 10);
          if (pick) shares = parseInt(pick);
        }
      }

      // 安全過濾：排除極端異常數據
      if (!shares || shares < 1 || shares > 5000000) continue;

      assets.push({
        id: Date.now() + Math.random(),
        name: ticker,
        fullName: "---",
        price: 0,
        shares: shares,
        leverage: 1,
        targetRatio: 0,
      });
    }

    if (assets.length > 0) {
      const unique = Array.from(
        new Map(assets.map((a) => [a.name, a])).values()
      );
      onComplete(unique);
      if (window.showToast)
        window.showToast(`辨識成功！發現 ${unique.length} 筆資產`);
    } else {
      if (window.showToast)
        window.showToast("未能辨識有效資料，請對準表格拍攝");
    }
  } catch (err) {
    console.error("OCR 錯誤:", err);
    if (window.showToast) window.showToast("辨識衝突，請重新整理頁面");
  } finally {
    e.target.value = "";
  }
}
