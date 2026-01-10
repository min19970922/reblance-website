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
 * utils.js - 關鍵字錨點辨識版
 * 模擬標題對應邏輯，精準定位股數欄位
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  showToast("正在分析表格結構...");

  try {
    const worker = await Tesseract.createWorker("chi_tra+eng");
    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();

    console.log("辨識原始文字:", text);

    const lines = text.split("\n");
    const newAssets = [];

    // 定義台灣券商常見的「類別」關鍵字作為錨點
    const anchors = ["現買", "現賣", "現貨", "融資", "融券", "擔保品"];

    lines.forEach((line) => {
      // 1. 搜尋股票代碼 (4-6位數字)
      const codeMatch = line.match(/\b(\d{4,6}[A-Z]?)\b/);

      if (codeMatch) {
        const code = codeMatch[1];
        let shares = 0;

        // 2. 尋找錨點關鍵字，定位「股數」應該出現的位置
        let foundAnchor = false;
        anchors.forEach((anchor) => {
          if (line.includes(anchor) && !foundAnchor) {
            // 抓取錨點之後的文字片段
            const parts = line.split(anchor);
            const textAfterAnchor = parts[parts.length - 1];

            // 抓取該片段中的第一個數字，這通常就是「股數」
            const numberMatch = textAfterAnchor.match(/[\d,]+/);
            if (numberMatch) {
              shares = parseInt(numberMatch[0].replace(/,/g, ""));
              foundAnchor = true;
            }
          }
        });

        // 3. 防呆機制：如果找不到錨點，則退回使用代碼後的第一個長數字邏輯
        if (!foundAnchor || shares === 0) {
          const numbers = line.replace(code, "").match(/[\d,]{2,}/g) || [];
          if (numbers.length > 0) {
            shares = parseInt(numbers[0].replace(/,/g, ""));
          }
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
    });

    if (newAssets.length > 0) {
      onComplete(newAssets);
      showToast(`成功對應匯入 ${newAssets.length} 筆資產`);
    } else {
      showToast("無法對應標題欄位，請確認照片清晰度");
    }
  } catch (err) {
    console.error("OCR Error:", err);
    showToast("辨識過程發生錯誤");
  } finally {
    e.target.value = "";
  }
}
