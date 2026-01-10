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
  showToast("啟動 AI 視覺大腦辨識 (v28.2)...");

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

  try {
    const base64Image = await fileToBase64(file);

    // --- 修正點 1：確保從 window 讀取到最新值 ---
    // 有時候因為模組化載入順序，直接用變數會抓不到，改用 window.XXX 確保讀取全域
    const apiKey = window.GEMINI_API_KEY;

    // 嚴格檢查：如果抓不到或是預設字串，直接中斷
    if (!apiKey || apiKey === "你的_API_KEY_字串" || apiKey.length < 10) {
      throw new Error(
        "API Key 尚未設定。請檢查 index.html 中的 window.GEMINI_API_KEY"
      );
    }

    // --- 修正點 2：更正模型名稱與網址 ---
    // 確保使用 1.5 系列，不要使用 2.5 (目前不存在)
    const model = "gemini-1.5-flash";
    const mimeType = file.type || "image/png";

    // 構建 API 網址 (確保 apiKey 有被填入)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemPrompt = `你是一位專業的台灣證券數據分析師...`;
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
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        // 注意：如果 API 報 400 錯誤，可能是 responseSchema 格式問題，
        // 建議先移除 responseSchema 測試，或確保格式完全正確。
      },
    };

    let assets = [];
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json();
      // 如果這裡報 403，請檢查 Google Cloud Console 裡的 API 是否已啟動
      throw new Error(
        errData.error?.message || `請求失敗 (${response.status})`
      );
    }

    const result = await response.json();
    const rawJson = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (rawJson) {
      const parsedData = JSON.parse(rawJson);
      assets = parsedData.assets || [];
    }

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
      showToast("AI 未能從圖片中辨識出有效的股號或股數");
    }
  } catch (err) {
    console.error("AI辨識詳細錯誤:", err);
    // 這裡會顯示具體的錯誤原因，例如 "API Key not found"
    showToast(`錯誤: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}
