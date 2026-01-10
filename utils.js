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
  showToast("啟動 AI 視覺大腦辨識 (v28.1)...");

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
    const mimeType = file.type || "image/png";

    // 專業級視覺分析指令
    const systemPrompt = `你是一位專業的台灣證券數據分析師。
你的任務是從這張庫存截圖中提取「股票代號」與「持有股數」。

規則：
1. 識別表格：尋找包含「商品」、「類別」、「股數」、「均價」或「現價」的標題行。
2. 提取對象：只抓取標題行下方的每一列資料。
3. 欄位解析：
   - [名稱/代號]：通常是 4-6 位數字，可能帶有字母（如 00631L 代表元大台灣50正2，請務必保留 L）。
   - [股數]：位於「類別（現買/擔保品/融資）」之後，「均價」之前。股數通常是整數。
4. 排除雜訊：絕對不要包含頂部的「總成本」、「總股數」、「總市值」或「帳號資訊」。
5. 資料清理：移除所有逗號與空格，確保股數為純數字。
6. 修正字元：若股數首位出現 / 或 |，請將其識別為 7 或 1。`;

    const userQuery = "請將這張截圖中的所有持股代號與股數轉換為 JSON 陣列。";

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: userQuery },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image.split(",")[1],
              },
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
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
                  name: {
                    type: "STRING",
                    description: "股票代號，例如 2330 或 00631L",
                  },
                  shares: {
                    type: "NUMBER",
                    description: "持有股數，例如 1000",
                  },
                },
                required: ["name", "shares"],
              },
            },
          },
        },
      },
    };

    // 2. 執行 API 請求 (含 5 次指數退避重試)
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

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || "API Request Failed");
        }

        const result = await response.json();
        const rawJson = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawJson) throw new Error("AI 回傳內容為空");

        const parsed = JSON.parse(rawJson);
        assets = parsed.assets || [];
        break;
      } catch (error) {
        retries++;
        if (retries === maxRetries) throw error;
        // 指數退避：1s, 2s, 4s, 8s, 16s
        await new Promise((res) =>
          setTimeout(res, Math.pow(2, retries - 1) * 1000)
        );
      }
    }

    // 3. 資料結構映射與校正
    if (assets.length > 0) {
      const formattedAssets = assets
        .map((a) => ({
          id: Date.now() + Math.random(),
          name: (a.name || "").toString().toUpperCase().trim(),
          fullName: "---",
          price: 0,
          shares: Math.abs(parseInt(a.shares) || 0),
          leverage: 1,
          targetRatio: 0,
        }))
        .filter((a) => a.name.length >= 4 && a.shares > 0);

      onComplete(formattedAssets);
      showToast(`AI 辨識成功！發現 ${formattedAssets.length} 筆資產`);
    } else {
      showToast("AI 未能從圖片中找到持股數據");
    }
  } catch (err) {
    console.error("AI辨識詳細錯誤:", err);
    showToast("AI 服務暫時繁忙，請再試一次");
  } finally {
    e.target.value = "";
  }
}
