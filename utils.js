/**
 * utils.js - 終極修正相容版
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

  const apiKey =
    window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) {
    showToast("❌ 請先設定 API Key");
    return;
  }

  showToast("啟動 AI 辨識中...");

  const base64 = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
  });

  // 使用 v1 穩定版與標準模型路徑
  const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  // 混合式 Prompt：將規則直接寫入對話內容，確保 v1/v1beta 通用
  const payload = {
    contents: [
      {
        parts: [
          {
            text: '你是一位股票分析助手。請從圖片中提取持股代號(name)與股數(shares)。請嚴格只回傳 JSON 格式如下：{"assets": [{"name":"2330","shares":1000}]}',
          },
          {
            inline_data: { mime_type: file.type || "image/png", data: base64 },
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "請求失敗");
    }

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const assets = JSON.parse(text).assets || [];
    onComplete(
      assets.map((a) => ({
        id: Date.now() + Math.random(),
        name: a.name.toString().toUpperCase().trim(),
        fullName: "---",
        price: 0,
        shares: Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0),
        leverage: 1,
        targetRatio: 0,
      }))
    );
    showToast("辨識成功！");
  } catch (err) {
    console.error(err);
    showToast("辨識錯誤: " + err.message);
  } finally {
    e.target.value = "";
  }
}
