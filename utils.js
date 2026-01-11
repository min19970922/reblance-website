/**
 * utils.js - AI 智投鎖定增強版 (v26.1)
 */
import { safeNum, calculateAccountData } from "./state.js";
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
    ["目標總槓桿", acc.targetExp || 1.0],
    [],
    [
      "代號",
      "標的全稱",
      "目前單價",
      "持有股數",
      "槓桿倍數",
      "目標權重%",
      "鎖定",
    ],
  ];
  acc.assets.forEach((a) =>
    data.push([
      a.name,
      a.fullName || "",
      a.price,
      a.shares,
      a.leverage,
      a.targetRatio,
      a.isLocked ? "YES" : "NO",
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
        targetExp: safeNum(rows[6][1], 1.0),
        assets: [],
      };
      for (let i = 8; i < rows.length; i++) {
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
            isLocked: r[6] === "YES",
          });
      }
      onComplete(newAcc);
      showToast("匯入成功！");
    } catch (err) {
      showToast("Excel 解析失敗");
    }
  };
  reader.readAsArrayBuffer(file);
}

export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;
  const apiKey =
    window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey || apiKey.length < 10) return showToast("❌ 請先設定 API Key");

  showToast("啟動 AI 視覺辨識中...");
  const fileToBase64 = (f) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => resolve(reader.result);
    });

  try {
    const base64Image = await fileToBase64(file);
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const promptText = `你是一位專業分析師。請提取圖片中的持股代號(name)與股數(shares)。若同一標的出現多次(如擔保品)，請合併股數。格式：JSON {"assets": [{"name":"2317","shares":14349}]}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    if (text) {
      const rawAssets = JSON.parse(text).assets || [];
      const mergedMap = new Map();
      rawAssets.forEach((a) => {
        const name = (a.name || "").toString().toUpperCase().trim();
        const shares = Math.abs(
          parseInt(a.shares.toString().replace(/,/g, "")) || 0
        );
        if (name) mergedMap.set(name, (mergedMap.get(name) || 0) + shares);
      });
      const formattedAssets = Array.from(mergedMap.entries()).map(
        ([name, shares]) => ({
          id: Date.now() + Math.random(),
          name,
          fullName: "---",
          price: 0,
          shares,
          leverage: 1,
          targetRatio: 0,
          isLocked: false,
        })
      );
      onComplete(formattedAssets);
    }
  } catch (err) {
    showToast(`辨識失敗: ${err.message}`);
  }
}

export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey =
    window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請先設定 API Key");

  // 1. 計算「固定預算」：鎖定資產比例總和 + 現金比例
  const lockedTotal =
    acc.assets.reduce((s, a) => s + (a.isLocked ? a.targetRatio : 0), 0) +
    acc.cashRatio;
  const remainingBudget = 100 - lockedTotal;

  if (remainingBudget <= 0)
    return showToast("❌ 剩餘預算不足 (鎖定資產已達或超過 100%)");

  // 2. 獲取「可調整資產」：排除被鎖定的標的
  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0)
    return showToast("❌ 找不到未鎖定的標的供 AI 規劃");

  showToast(`AI 智投規劃中 (預算: ${remainingBudget.toFixed(1)}%)...`);

  try {
    const promptText = `你是一位基金經理。
    【目標】總槓桿 ${targetExp}x。
    【剩餘預算】${remainingBudget.toFixed(1)}%。
    【資產清單】
    ${aiAssets.map((a) => `- ${a.name} (${a.fullName})`).join("\n")}
    
    【核心任務】
    請將 ${remainingBudget.toFixed(1)}% 比例分配給清單資產。
    1. 總和必須精確等於 ${remainingBudget.toFixed(1)}。
    2. 針對「正2」類槓桿ETF應更謹慎佔比。
    3. 只回傳 JSON：{"suggestions": [{"name": "代號", "targetRatio": 12.5}]}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
    });

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    if (text) {
      const suggestions = JSON.parse(text).suggestions || [];
      const aiSum = suggestions.reduce(
        (s, a) => s + parseFloat(a.targetRatio),
        0
      );
      const factor = remainingBudget / aiSum;

      const finalSuggestions = suggestions.map((sug) => ({
        name: sug.name,
        targetRatio: Math.round(sug.targetRatio * factor * 10) / 10,
      }));
      onComplete(finalSuggestions);
    }
  } catch (err) {
    showToast(`AI 配置失敗: ${err.message}`);
  }
}
