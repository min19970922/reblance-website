/**
 * utils.js - 專業辨識修復版 (v3.9)
 * 解決 WASM 報錯問題
 */
import { safeNum } from "./state.js";
import { showToast } from "./ui.js";

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
 * 強力修復：穩定版相機辨識
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在初始化穩定版引擎...");

  try {
    // 解決 WASM 崩潰的核心：指定正確的 Worker 與 Core 路徑
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

    const tokens = text.replace(/,/g, "").split(/\s+/);
    const newAssets = [];

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].includes("明細")) {
        const potentialCode = tokens[i + 1];
        const potentialShares = tokens[i + 3];

        if (potentialCode && potentialCode.length >= 4) {
          const code = potentialCode.toUpperCase();
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
      showToast("格式不符，請確認照片包含「明細」關鍵字");
    }
  } catch (err) {
    console.error("OCR 致命錯誤:", err);
    showToast("相機引擎衝突，請重新整理後重試");
  } finally {
    e.target.value = "";
  }
}
