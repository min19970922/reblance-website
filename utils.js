/**
 * utils.js
 * 職責：處理檔案匯入匯出 (Excel)、格式轉換以及非業務邏輯的通用工具
 */
import { safeNum } from "./state.js";
import { showToast } from "./ui.js";

/**
 * 將當前計畫匯出為 Excel 檔案
 * @param {Object} acc - 當前活動的帳戶物件
 */
export function exportExcel(acc) {
  if (!acc) return;

  // 建立 Excel 標題與基礎資訊
  const data = [
    ["計畫名稱", acc.name],
    ["美金匯率", acc.usdRate],
    ["可用現金", acc.currentCash],
    ["負債總額", acc.totalDebt],
    ["絕對門檻", acc.rebalanceAbs],
    ["相對門檻", acc.rebalanceRel],
    [], // 空行
    ["代號", "標的全稱", "目前單價", "持有股數", "槓桿倍數", "目標權重%"],
  ];

  // 填入資產清單
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

  // 利用 XLSX 函式庫生成檔案
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Portfolio");

  // 執行下載
  XLSX.writeFile(wb, `${acc.name}_財務快照.xlsx`);
}

/**
 * 處理 Excel 檔案匯入
 * @param {Event} e - Input change 事件
 * @param {Function} onComplete - 匯入成功後的 callback (通常傳入切換帳戶的函式)
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

      // 解析並建立新帳戶物件
      const newAcc = {
        id: "acc_" + Date.now(),
        name: rows[0][1].toString(),
        usdRate: safeNum(rows[1][1], 32.5),
        currentCash: safeNum(rows[2][1]),
        totalDebt: safeNum(rows[3][1]),
        rebalanceAbs: safeNum(rows[4][1], 5),
        rebalanceRel: safeNum(rows[5][1], 25),
        cashRatio: 0,
        assets: [],
      };

      // 從第 8 行開始解析資產 (陣列索引為 7)
      for (let i = 7; i < rows.length; i++) {
        const r = rows[i];
        if (r && r[0])
          newAcc.assets.push({
            id: Date.now() + i,
            name: r[0].toString(),
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
      console.error(err);
      showToast("Excel 解析失敗");
    } finally {
      e.target.value = ""; // 清空 input 讓同一個檔案可以重複觸發
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * utils.js - 深度全域辨識版 (修復只能辨識一個的問題)
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在深度分析表格結構...");

  try {
    const worker = await Tesseract.createWorker("chi_tra+eng");
    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();

    console.log("辨識原始文字:", text);

    // 1. 先處理掉逗號，避免股數 1,000 被切斷
    const cleanText = text.replace(/,/g, "");
    const newAssets = [];

    // 2. 定義台灣券商常見的錨點
    const anchors = ["現買", "現賣", "現貨", "融資", "融券", "擔保品"];

    // 3. 改用全域正則：尋找 4-6 位代碼
    const codeRegex = /\b(\d{4,6}[A-Z]?)\b/g;
    let match;

    while ((match = codeRegex.exec(cleanText)) !== null) {
      const code = match[1];
      let shares = 0;

      // 擷取代碼後方約 100 個字元的片段來找股數
      const contextSnippet = cleanText.substring(
        match.index,
        match.index + 100
      );

      // 優先尋找錨點後方的數字
      let foundAnchor = false;
      for (const anchor of anchors) {
        if (contextSnippet.includes(anchor)) {
          const partAfterAnchor = contextSnippet.split(anchor)[1];
          const numMatch = partAfterAnchor.match(/\d+/);
          if (numMatch) {
            shares = parseInt(numMatch[0]);
            foundAnchor = true;
            break;
          }
        }
      }

      // 如果沒找到錨點，抓代碼後方的第一個大於 0 的數字
      if (!foundAnchor || shares === 0) {
        const trailingNums = contextSnippet.replace(code, "").match(/\d{2,}/g);
        if (trailingNums) shares = parseInt(trailingNums[0]);
      }

      if (shares > 0) {
        newAssets.push({
          id: Date.now() + Math.random(),
          name: code,
          fullName: "辨識成功 (載入中...)",
          price: 0,
          shares: shares,
          leverage: 1,
          targetRatio: 0,
        });
      }
    }

    if (newAssets.length > 0) {
      // 過濾掉可能的重複辨識
      const uniqueAssets = Array.from(
        new Map(newAssets.map((a) => [a.name, a])).values()
      );
      onComplete(uniqueAssets);
      showToast(`成功辨識 ${uniqueAssets.length} 筆資產`);
    } else {
      showToast("無法對應標題欄位，請確認照片清晰度");
    }
  } catch (err) {
    console.error("OCR Error:", err);
    showToast("辨識發生錯誤");
  } finally {
    e.target.value = "";
  }
}
