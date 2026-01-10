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
 * 相機明細辨識加強版
 * 規則：搜尋「明細」 -> 擷取後一個 Token 中的 4-6 位英數代碼 -> 跳兩格 -> 擷取股數
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在初始化穩定版引擎...");

  try {
    // 解決 WASM 報錯：顯式指定路徑
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

    console.log("辨識成功內容:", text);

    const tokens = text.replace(/,/g, "").split(/\s+/);
    const newAssets = [];

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].includes("明細")) {
        // [i]明細 -> [i+1]通常為 "代碼+名稱" (如: 00631L元大台灣50正2)
        const rawCodeAndName = tokens[i + 1];

        // 正則表達式：擷取開頭 4-6 位的英數組合 (代碼)
        const codeMatch = rawCodeAndName
          ? rawCodeAndName.match(/^([A-Z0-9]{4,6})/)
          : null;

        if (codeMatch) {
          const code = codeMatch[1].toUpperCase(); // 強制轉大寫

          // 規則：代碼後跳過一格 [i+2] 類別, [i+3] 即為股數
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
      showToast(`成功辨識 ${newAssets.length} 筆明細資產`);
    } else {
      showToast("未偵測到明細關鍵字或格式不符");
    }
  } catch (err) {
    console.error("OCR 致命錯誤:", err);
    showToast("相機引擎衝突，請重新整理頁面重試");
  } finally {
    e.target.value = "";
  }
}
