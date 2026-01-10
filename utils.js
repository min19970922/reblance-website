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

  if (window.showToast) window.showToast("正在智慧辨識 (v6.0)…");

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
    const assets = [];

    for (let line of rawLines) {
      // ⚡ 表格啟動錨點
      if (
        line.includes("商品") ||
        line.includes("類別") ||
        line.includes("股數") ||
        line.includes("均價")
      ) {
        isTableStarted = true;
        continue;
      }

      // ⚡ 過濾非表格 & 垃圾行
      if (
        !isTableStarted ||
        line.includes("總股數") ||
        line.includes("總成本") ||
        line.includes("帳號") ||
        line.includes("總額")
      )
        continue;

      let clean = line.replace(/,/g, "");

      /**
       * 🎯 股票代碼規則
       * 4~5 位數字 + 可選英文字母 1 位
       * 範例：
       * 00631L
       * 00935
       * 6811U
       */
      const tickerMatch = clean.match(/\b(\d{4,5}[A-Z]?)\b/);

      if (!tickerMatch) continue;
      const ticker = tickerMatch[1].toUpperCase();

      // 代碼後面的字串
      const after = clean.substring(tickerMatch.index + tickerMatch[1].length);

      // 修復 7 000 → 7000
      const fixed = after.replace(/(\b\d{1,3})\s+(\d{3})(?!\d)/g, "$1$2");

      /**
       * 🎯 股數抽取（必須跟交易類型）
       */
      const categoryMatch = fixed.match(
        /(現買|擔保品|融資|庫存|普通|現賣|現股)[^\d]*?(\d{2,6})/
      );

      let shares = 0;
      if (categoryMatch) shares = parseInt(categoryMatch[2]);

      // 備援：取代碼後第一個合理大數字
      if (!shares) {
        const nums = fixed.match(/\b\d{2,6}\b/g);
        if (nums) {
          const pick = nums.find((n) => parseInt(n) > 10);
          if (pick) shares = parseInt(pick);
        }
      }

      // 安全濾網
      if (!shares || shares < 10 || shares > 1000000) continue;

      assets.push({
        id: Date.now() + Math.random(),
        name: ticker,
        shares,
      });
    }

    if (assets.length) {
      // 去重
      const unique = Array.from(
        new Map(assets.map((a) => [a.name, a])).values()
      );
      onComplete(unique);
      if (window.showToast)
        window.showToast(`辨識成功！取得 ${unique.length} 筆股票`);
    } else {
      if (window.showToast)
        window.showToast("未能辨識有效股票資料，請確認截圖清晰");
    }
  } catch (err) {
    if (window.showToast) window.showToast("辨識失敗，請重試");
  } finally {
    e.target.value = "";
  }
}
