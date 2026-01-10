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

  const showToast = window.showToast || console.log;
  showToast("啟動 AI 視覺大腦辨識 (v28.0)...");

  // 1. 圖片轉 Base64 輔助函式
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

  try {
    const base64Image = await fileToBase64(file);
    const apiKey = ""; // 執行環境自動注入
    const model = "gemini-2.5-flash-preview-09-2025";

    const prompt = `
      這是一張證券APP的庫存/未實現損益截圖。
      請精確提取表格中的：
      1. 股票代號 (Ticker)
      2. 持有股數 (Shares)
      
      請注意：
      - 排除頂部的總計數字（如總股數、總市值、總預估損益）。
      - 股數通常是整數。
      - 區分「股數」與「均價/現價」，不要將它們黏在一起。
      - 如果代號中包含字母（如 00631L），請正確識別。
    `;

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: base64Image.split(",")[1],
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            assets: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  shares: { type: "NUMBER" },
                },
                required: ["name", "shares"],
              },
            },
          },
        },
      },
    };

    // 2. 執行 API 請求（含 5 次指數退避重試）
    let retries = 0;
    const maxRetries = 5;
    let assets = [];

    while (retries < maxRetries) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok) throw new Error("API Request Failed");

        const result = await response.json();
        const rawJson = result.candidates?.[0]?.content?.parts?.[0]?.text;
        assets = JSON.parse(rawJson).assets || [];
        break; // 成功則跳出重試迴圈
      } catch (error) {
        retries++;
        if (retries === maxRetries) throw error;
        await new Promise((res) =>
          setTimeout(res, Math.pow(2, retries) * 1000)
        );
      }
    }

    // 3. 將 AI 結果映射至原系統資產格式
    if (assets.length > 0) {
      const formattedAssets = assets.map((a) => ({
        id: Date.now() + Math.random(),
        name: a.name.toUpperCase(),
        fullName: "---",
        price: 0,
        shares: a.shares,
        leverage: 1,
        targetRatio: 0,
      }));

      onComplete(formattedAssets);
      showToast(`AI 辨識成功！發現 ${formattedAssets.length} 筆資產`);
    } else {
      showToast("AI 未能識別有效數據");
    }
  } catch (err) {
    console.error("AI辨識錯誤:", err);
    showToast("AI 服務異常，請稍後重試");
  } finally {
    e.target.value = ""; // 清空 input 讓下次選擇同一張圖也能觸發
  }
}
