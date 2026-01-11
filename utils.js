/**
 * utils.js - 核心工具與 AI 智投邏輯版 (V25.2)
 */
import { safeNum, calculateAccountData } from "./state.js";
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
    ["目標總槓桿", acc.targetExp || 1.0],
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

/**
 * AI 視覺辨識：從圖片提取持股並合併重複標的
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;
  const apiKey =
    window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey || apiKey.length < 10) {
    showToast("❌ 請先設定並儲存 API Key");
    e.target.value = "";
    return;
  }
  showToast("啟動 AI 視覺辨識中...");
  const fileToBase64 = (f) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

  try {
    const base64Image = await fileToBase64(file);
    const model = "gemini-flash-latest";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const promptText = `你是一位專業分析師。請提取圖片中的持股代號(name)與股數(shares)。
    注意：如果同一個標的出現多次（例如包含「現買」與「擔保品」），請務必將股數相加合併為一筆。
    請嚴格只回傳 JSON 格式，不要有任何解釋文字。
    範例格式：{"assets": [{"name":"2317","shares":14349}]}`;

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

    if (!response.ok) throw new Error("AI 請求失敗");
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
        if (name && shares > 0) {
          mergedMap.set(name, (mergedMap.get(name) || 0) + shares);
        }
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
        })
      );
      onComplete(formattedAssets);
      showToast(`AI 辨識成功！已合併重複項，共 ${formattedAssets.length} 筆`);
    }
  } catch (err) {
    showToast(`辨識失敗: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}

/**
 * AI 智投智配：根據目標槓桿規劃剩餘比例 (精確至一位小數)
 */
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey =
    window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請先設定 API Key");

  // 1. 計算剩餘預算：排除「手動已輸入目標比」的標的與「現金目標」
  const manualTotal =
    acc.assets.reduce(
      (s, a) => s + (a.targetRatio > 0 ? a.targetRatio : 0),
      0
    ) + acc.cashRatio;
  const remainingBudget = Math.max(0, 100 - manualTotal);

  if (remainingBudget <= 0) {
    showToast("❌ 已無剩餘預算可分配 (目標比總和已達 100%)");
    return;
  }

  // 2. 準備待分配資產清單 (targetRatio 為 0 的標的)
  const aiAssets = acc.assets.filter((a) => a.targetRatio === 0);
  if (aiAssets.length === 0) {
    showToast("❌ 找不到 targetRatio 為 0 的待規劃標的");
    return;
  }

  showToast("AI 智投專家分析中...");

  try {
    const promptText = `你是一位專業的量化基金經理。
    【現狀】目標總實質槓桿：${targetExp}x。
    【預算】已手動分配比例總計：${manualTotal}% (含現金 ${acc.cashRatio}%)。
    【任務】請將剩餘的 ${remainingBudget.toFixed(
      1
    )}% 比例，精準分配給下列待規劃標的。
    【待規劃清單】：
    ${aiAssets.map((a) => `- ${a.name} (${a.fullName})`).join("\n")}
    
    【核心規則】：
    1. 建議的 targetRatio 總和必須嚴格等於 ${remainingBudget.toFixed(1)}。
    2. 風險控制：對於槓桿型 ETF (如正2) 分配應保守；權值股可較穩健。
    3. 產業分散：避免資金過度集中。
    4. 回傳格式：僅回傳 JSON，數值保留一位小數。範例：{"suggestions": [{"name": "2330", "targetRatio": 12.5}]}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
    });

    if (!response.ok) throw new Error("AI 分析請求失敗");
    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    if (text) {
      const suggestions = JSON.parse(text).suggestions || [];

      // 歸一化處理 (Normalization)：確保總和剛好等於剩餘預算
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
