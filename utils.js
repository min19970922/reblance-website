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

  if (!apiKey) {
    showToast("❌ 請先設定並儲存 API Key");
    return;
  }

  showToast("啟動 AI 辨識中...");

  const base64 = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
  });

  // 使用 v1beta 與完整模型路徑
  const model = "gemini-pro-vision";
  const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

  // 核心修正：避開所有可能導致 400/404 的高階參數，將指令塞入內容
  const payload = {
    contents: [
      {
        parts: [
          {
            text: '你是一位股票助手。請從圖片提取持股代號(name)與股數(shares)，嚴格以JSON輸出: {"assets": [{"name":"2330","shares":1000}]}',
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
      // 如果 404，嘗試更換模型識別碼為 gemini-1.5-flash-latest
      throw new Error(err.error?.message || "請求失敗");
    }

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 清理 Markdown
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
    console.error("AI辨識錯誤:", err);
    showToast("辨識錯誤: " + err.message);
  } finally {
    e.target.value = "";
  }
}
