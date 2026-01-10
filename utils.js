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

  if (window.showToast) window.showToast("正在智慧辨識 (v5.5)...");

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
    let isTableStarted = false;
    const newAssets = [];

    for (const line of rawLines) {
      // 1. 強力過濾統計行：徹底排除「總股數: 17040」等雜訊
      if (
        line.includes("總股數") ||
        line.includes("總市值") ||
        line.includes("帳號") ||
        line.includes("總成本") ||
        line.includes("未實現")
      ) {
        continue;
      }

      // 2. 偵測表格起點 (但不跳過包含代碼的行)
      if (
        !isTableStarted &&
        (line.includes("明細") ||
          line.includes("商品") ||
          line.includes("類別"))
      ) {
        isTableStarted = true;
        // 如果這一行沒有數字(代表是純標頭)，才跳過
        if (!/\d/.test(line)) continue;
      }

      if (isTableStarted) {
        let cleanLine = line.replace(/,/g, "");
        // 台股代碼規則：4-5位數字，或5位數字+1位英數
        const tickerMatch = cleanLine.match(/([0-9]{4,5}[A-Z1]?)/);

        if (tickerMatch) {
          let ticker = tickerMatch[1].toUpperCase();
          if (ticker.length === 6 && ticker.endsWith("1"))
            ticker = ticker.slice(0, -1) + "L";

          const afterTicker = cleanLine.substring(
            tickerMatch.index + tickerMatch[1].length
          );
          // 手機版斷裂合併 (如 7 000)
          const joinedPart = afterTicker.replace(
            /(\b\d{1,3})\s+(\d{3})(?!\d)/g,
            "$1$2"
          );

          // 股數定位：鎖定類別後的長數字，避開名稱內的 50 正 2
          const categoryMatch = joinedPart.match(
            /(?:現買|擔保品|融資|普通|庫存|現賣|融券|現|買|賣)[^\d]*(\d{2,})/
          );

          let shares = 0;
          if (categoryMatch) {
            shares = parseInt(categoryMatch[1]);
          } else {
            const allNums = joinedPart.match(/\b\d{2,}\b/g);
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
      }
    }

    if (newAssets.length > 0) {
      const uniqueAssets = Array.from(
        new Map(newAssets.map((a) => [a.name, a])).values()
      );
      onComplete(uniqueAssets);
      if (window.showToast)
        window.showToast(`成功辨識 ${uniqueAssets.length} 筆資產`);
    } else {
      if (window.showToast)
        window.showToast("未能辨識有效資料，請對準表格拍攝");
    }
  } catch (err) {
    if (window.showToast) window.showToast("辨識衝突，請重新整理");
  } finally {
    e.target.value = "";
  }
}
