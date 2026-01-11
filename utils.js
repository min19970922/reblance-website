/**
 * utils.js - 完整功能版 (v28.5)
 * 整合：多計畫附加匯入、完整照片辨識邏輯、歸一化 AI 智投
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

/**
 * 匯入 Excel (多計畫附加模式)
 */
export function importExcel(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const ab = evt.target.result;
      const wb = XLSX.read(ab, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

      // 檢查是否為有效的系統檔案
      if (!rows[0] || rows[0][0] !== "計畫名稱") {
        throw new Error("Excel 格式不正確或非本系統匯出檔案");
      }

      // 解析計畫資訊
      const newAcc = {
        id: "acc_" + Date.now() + Math.floor(Math.random() * 1000),
        name: rows[0][1] ? rows[0][1].toString() : "匯入計畫",
        usdRate: safeNum(rows[1][1], 32.5),
        currentCash: safeNum(rows[2][1]),
        totalDebt: safeNum(rows[3][1]),
        rebalanceAbs: safeNum(rows[4][1], 5),
        rebalanceRel: safeNum(rows[5][1], 25),
        targetExp: safeNum(rows[6] ? rows[6][1] : 1.0, 1.0),
        assets: [],
      };

      // 解析資產清單 (從第 9 列開始)
      for (let i = 8; i < rows.length; i++) {
        const r = rows[i];
        if (r && r[0] && r[0] !== "代號") {
          newAcc.assets.push({
            id: Date.now() + i + Math.random(),
            name: r[0].toString().toUpperCase(),
            fullName: r[1] || "",
            price: safeNum(r[2]),
            shares: safeNum(r[3]),
            leverage: safeNum(r[4], 1),
            targetRatio: safeNum(r[5]),
            isLocked: r[6] === "YES"
          });
        }
      }

      onComplete(newAcc); // 傳回給 main.js 執行附加
      showToast(`✅ 已附加計畫：「${newAcc.name}」`);
    } catch (err) {
      console.error(err);
      showToast("❌ 匯入失敗：" + err.message);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * AI 照片辨識：修正 Base64 處理與合併邏輯
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  showToast("🚀 啟動 AI 視覺辨識(含槓桿判斷)...");

  const fileToBase64 = (f) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(f);
    reader.onload = () => resolve(reader.result);
  });

  try {
    const base64Data = await fileToBase64(file);
    const base64Content = base64Data.split(",")[1];
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    // 重新設計指令：強制要求精確 JSON，分開辨識與邏輯
    const promptText = `請分析此股票庫存截圖。
    1. 提取所有持股代號(name)與總股數(shares)。
    2. 判斷槓桿倍數(leverage)：標的含「正2」、「L」、「2X」或「兩倍」給 2.0，其餘給 1.0。
    3. 同代號出現多次請合併股數。
    只回傳 JSON 格式：{"assets": [{"name":"代號","shares":1000,"leverage":1.0}]}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: file.type || "image/png", data: base64Content } }] }] })
    });

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const rawAssets = JSON.parse(text).assets || [];
      const mergedMap = new Map();
      rawAssets.forEach((a) => {
        const name = (a.name || "").toString().toUpperCase().trim();
        const shares = Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0);
        const leverage = parseFloat(a.leverage) || 1.0;
        if (name && shares > 0) {
          const existing = mergedMap.get(name) || { shares: 0, leverage };
          mergedMap.set(name, { shares: existing.shares + shares, leverage });
        }
      });
      const formattedAssets = Array.from(mergedMap.entries()).map(([name, info]) => ({
        id: Date.now() + Math.random(),
        name,
        fullName: "---",
        price: 0,
        shares: info.shares,
        leverage: info.leverage,
        targetRatio: 0,
        isLocked: false
      }));
      onComplete(formattedAssets);
      showToast(`✅ 辨識完成！共 ${formattedAssets.length} 筆`);
    }
  } catch (err) {
    showToast(`❌ 辨識失敗，請確認圖片清晰度`);
  } finally { e.target.value = ""; }
}
/**
 * AI 智投建議 - 極限配額相容版 (v44.0)
 * 解決 429 (Too Many Requests) 報錯
 * 1. 使用 gemini-2.0-flash-lite 避開標準版 0 配額限制
 * 2. 強化指數退避 (Exponential Backoff) 重試邏輯
 */
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  const data = calculateAccountData(acc);
  const lockedTotal = acc.assets.reduce((s, a) => s + (a.isLocked ? parseFloat(a.targetRatio || 0) : 0), 0) + parseFloat(acc.cashRatio || 0);
  const remainingBudget = Math.max(0, 100 - lockedTotal);

  if (remainingBudget <= 0) return showToast("❌ 預算已滿，無剩餘權重可分配");

  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 無未鎖定標的");

  /**
   * 強化版重試機制：專門對付 429
   */
  async function fetchWithRetry(url, options, retries = 3, backoff = 5000) {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      // 遇到 429 時，強制等待並逐步增加時間 (5s -> 10s -> 20s)
      showToast(`⏳ AI 忙碌，${backoff / 1000}秒後自動重試...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return res;
  }

  try {
    const aiAssetsInfo = aiAssets.map(a => {
      const curP = data.netValue > 0 ? (parseFloat(a.bookValue || 0) / data.netValue) * 100 : 0;
      return `${a.name},目前${curP.toFixed(1)}%,槓桿${a.leverage}x`;
    }).join("|");

    const promptText = `Task: Assign ${remainingBudget.toFixed(1)}% budget to assets. 
    Goal: Target Total Portfolio Leverage ${targetExp}x (Now: ${data.totalLeverage.toFixed(2)}x).
    Rule: Sum must be ${remainingBudget.toFixed(1)}. JSON ONLY.
    Data: [${aiAssetsInfo}]
    Format: {"suggestions": [{"name":"TICKER","targetRatio":20}]}`;

    // --- 關鍵修正：改用診斷清單中配額最穩定的 Lite 模型 ---
    const model = "gemini-2.0-flash-lite";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `API 錯誤: ${response.status}`);
    }

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const suggestions = JSON.parse(text).suggestions || [];
      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);
      const factor = aiSum > 0 ? remainingBudget / aiSum : 1;

      const finalSuggestions = suggestions.map(sug => ({
        name: sug.name.toString().toUpperCase().trim(),
        targetRatio: Math.round(sug.targetRatio * factor * 10) / 10,
      }));

      onComplete(finalSuggestions);
    }
  } catch (err) {
    console.error("AI Error:", err);
    showToast(`❌ AI 智投暫時失效: ${err.message}`);
  }
}