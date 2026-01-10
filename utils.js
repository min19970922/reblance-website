/**
 * utils.js - 動態 Key 加強版
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

export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  const showToast = window.showToast || console.log;
  const apiKey =
    window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");

  if (!apiKey || apiKey.length < 10) {
    showToast("❌ 請先設定並儲存 API Key");
    e.target.value = "";
    return;
  }

  showToast("啟動 AI 視覺大腦辨識...");

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

  try {
    const base64Image = await fileToBase64(file);

    // --- 關鍵修正點：路徑必須使用 v1beta ---
    const model = "gemini-1.5-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const promptText = `你是一位專業分析師。請提取圖片中的持股代號(name)與股數(shares)。
    請嚴格只回傳 JSON 格式，不要有任何 Markdown 標籤或解釋文字。
    格式範例：{"assets": [{"name":"2330","shares":1000}]}`;

    // --- 關鍵修正點：REST API 必須使用 snake_case (底線命名) ---
    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: file.type || "image/png",
                data: base64Image.split(",")[1],
              },
            },
          ],
        },
      ],
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(
        errData.error?.message || `請求失敗 (${response.status})`
      );
    }

    const result = await response.json();
    let rawJson = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 清理 Markdown 標籤以防解析失敗
    rawJson = rawJson
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let assets = [];
    if (rawJson) {
      try {
        const parsedData = JSON.parse(rawJson);
        assets = parsedData.assets || [];
      } catch (e) {
        console.error("JSON 解析失敗:", rawJson);
        throw new Error("AI 回傳格式異常，請再試一次");
      }
    }

    if (assets.length > 0) {
      const formattedAssets = assets
        .map((a) => ({
          id: Date.now() + Math.random(),
          name: (a.name || "").toString().toUpperCase().trim(),
          fullName: "---",
          price: 0,
          shares: Math.abs(
            parseInt(a.shares.toString().replace(/,/g, "")) || 0
          ),
          leverage: 1,
          targetRatio: 0,
        }))
        .filter((a) => a.name.length >= 2 && a.shares > 0);

      onComplete(formattedAssets);
      showToast(`AI 辨識成功！發現 ${formattedAssets.length} 筆資產`);
    } else {
      showToast("AI 未能從圖片辨識出有效內容");
    }
  } catch (err) {
    console.error("AI辨識詳細錯誤:", err);
    showToast(`辨識失敗: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}
