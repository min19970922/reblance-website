/**
 * utils.js - v82.0 專業智投版
 * 更新：
 * 1. 智投建議：採用使用者提供的「量化基金經理 (Quantitative Portfolio Manager)」Prompt
 * 2. 資料格式：微調送給 AI 的數據格式，以配合新的 Prompt 要求
 * 3. 核心功能：保留代號清洗、JSON 暴力解析、多模型備援
 */
import { safeNum, calculateAccountData } from "./state.js";
import { showToast } from "./ui.js";

// =========================================
// 1. 圖片壓縮
// =========================================
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 1024;
      if (width > height) {
        if (width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = (err) => reject(err);
  });
};

// =========================================
// 2. 輔助函式：暴力提取 JSON
// =========================================
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) { }
    }
    throw new Error("AI 回傳格式錯誤 (無法解析 JSON)");
  }
}

// =========================================
// 3. 智慧請求函式 (含備援邏輯)
// =========================================
async function fetchWithFallback(models, payload, apiKey) {
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    if (i > 0) showToast(`⚠️ 切換至備用線路 (${model})...`);

    try {
      const response = await internalFetch(url, payload);
      if (response.ok) return response;

      const errData = await response.json().catch(() => ({}));
      const msg = errData.error?.message || "Unknown";
      console.warn(`模型 ${model} 失敗: ${msg}`);
      throw new Error(`Status ${response.status}: ${msg}`);
    } catch (err) {
      lastError = err;
      if (i === models.length - 1) break;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw lastError;
}

async function internalFetch(url, payload) {
  await new Promise(r => setTimeout(r, 800));
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// =========================================
// 4. AI 照片辨識 (代號清洗 + 備援)
// =========================================
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  showToast("🔄 處理圖片中 (1/3)...");

  try {
    const compressedBase64 = await compressImage(file);
    const base64Content = compressedBase64.split(",")[1];

    showToast("🤖 AI 視覺分析中 (2/3)...");

    // 強化 Prompt：明確要求忽略總計列，並正確處理槓桿
    const promptText = `Analyze table. Extract Stock Symbol (TICKER) and Shares. 
    Rule 1: If ticker is mixed with name (e.g. '00631L元大'), extract ONLY '00631L'.
    Rule 2: If name contains '正2', '2X', or 'L', set leverage to 2.0. Otherwise 1.0.
    Rule 3: Ignore Summary or Total rows.
    JSON ONLY: {"assets": [{"name":"TICKER", "shares":100, "leverage":1.0}]}`;

    const payload = {
      contents: [{
        parts: [
          { text: promptText },
          { inline_data: { mime_type: "image/jpeg", data: base64Content } }
        ]
      }]
    };

    const models = ["gemini-2.5-flash", "gemini-flash-latest"];
    const response = await fetchWithFallback(models, payload, apiKey);
    const result = await response.json();

    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    showToast("⚡ 資料解析中 (3/3)...");

    if (text) {
      const parsedData = extractJSON(text);
      const assets = parsedData.assets || [];
      const assetMap = new Map();

      assets.forEach((a) => {
        let rawName = (a.name || "").toString().toUpperCase().trim();
        const match = rawName.match(/^([A-Z0-9]+)/);
        const cleanName = match ? match[1] : rawName;

        if (cleanName.length < 2) return;

        // 強化數值清理：移除逗號、括號，確保轉為純數字
        const shares = Math.abs(parseInt(a.shares.toString().replace(/[,()]/g, "")) || 0);
        const leverage = parseFloat(a.leverage) || 1.0;

        if (assetMap.has(cleanName)) {
          const existing = assetMap.get(cleanName);
          existing.shares += shares;
          existing.leverage = Math.max(existing.leverage, leverage);
        } else {
          assetMap.set(cleanName, {
            id: Date.now() + Math.random(),
            name: cleanName,
            fullName: "---",
            price: 0,
            shares: shares,
            leverage: leverage,
            targetRatio: 0,
            isLocked: false
          });
        }
      });

      const finalAssets = Array.from(assetMap.values());
      onComplete(finalAssets);
      showToast(`✅ 辨識成功！已合併擔保品，共 ${finalAssets.length} 筆`);
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ 辨識失敗: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}
// =========================================
// 5. AI 智投建議 (專業量化經理 Prompt)
// =========================================
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  const data = calculateAccountData(acc);
  const lockedTotal = acc.assets.reduce((s, a) => s + (a.isLocked ? parseFloat(a.targetRatio || 0) : 0), 0) + parseFloat(acc.cashRatio || 0);
  const remainingBudget = Math.max(0, 100 - lockedTotal);

  if (remainingBudget <= 0) return showToast("❌ 預算已滿");
  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 無可規劃標的");

  showToast(`🧠 AI 主動經理人正在決策 (目標 ${targetExp}x)...`);

  // [資料格式] 包含當前權重，但這次 AI 有權力進行更有意義的調整
  const aiAssetsInfo = aiAssets.map(a =>
    `"${a.name}, Current Weight:${((parseFloat(a.bookValue) / data.netValue) * 100).toFixed(1)}%, Asset Leverage:${a.leverage}"`
  ).join("\n");

  try {
    // [Prompt 更新] 注入使用者的 4 大關鍵規則
    const promptText = `
    Role: Senior Quantitative Portfolio Manager (Active Management Style).

    Goal:
    Rebalance the unlocked assets to distribute EXACTLY ${remainingBudget.toFixed(2)}% weight.
    Achieve Target Portfolio Leverage: ${targetExp}x.

    [Input Data]
    Format: "Ticker, Current Weight%, Asset Leverage"
    ${aiAssetsInfo}

    [CRITICAL ALLOCATION RULES - MUST FOLLOW]
    1) **NO TRIVIAL ALLOCATION**: 
       - Do NOT simply evenly distribute the remaining budget (e.g., 5%, 5%, 5% is FORBIDDEN).
       - Avoid outcomes where most assets receive the same percentage.
       - Allocations MUST reflect different importance.

    2) **Role-Based Thinking**:
       - Infer roles based on Ticker/Leverage:
       - **Core Anchors** (e.g., Broad Market ETFs, low volatility): Assign LARGER, meaningful weights.
       - **Growth/Satellite**: Moderate allocations.
       - **Speculative / High Risk**: Smaller but intentional allocations.

    3) **Meaningful Portfolio**:
       - The plan must look like a real fund manager's strategy, not a mathematical compromise.
       - Create a hierarchy of conviction.

    4) **Explicit Decision Making**:
       - You are REQUIRED to make strong allocation decisions.
       - Do not "play it safe" by flattening the curve.

    [Constraints & Risk Control]
    - **Leverage Logic**: Use high-leverage assets (2x/3x) primarily to hit the ${targetExp}x target efficiently.
    - **Concentration Cap**: Max single asset < 40% (unless user already exceeds this).
    - **Math**: Sum of suggestions MUST equal EXACTLY ${remainingBudget.toFixed(2)}.

    [Output]
    JSON ONLY. No markdown.
    Format: {"suggestions":[{"name":"TICKER","targetRatio": 15.5}]}
    `;

    const payload = { contents: [{ parts: [{ text: promptText }] }] };

    // 使用邏輯推理能力最強的模型
    const models = ["gemini-2.0-flash-exp", "gemini-flash-latest", "gemini-pro"];

    const response = await fetchWithFallback(models, payload, apiKey);
    const result = await response.json();

    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const parsedData = extractJSON(text);
      const suggestions = parsedData.suggestions || [];

      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);
      const factor = aiSum > 0 ? remainingBudget / aiSum : 1;

      onComplete(suggestions.map(s => ({
        name: s.name.toString().toUpperCase().trim(),
        targetRatio: Math.round(s.targetRatio * factor * 10) / 10,
      })));

      showToast("✅ 主動型配置建議已生成");
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ 智投失敗: ${err.message}`);
  }
}
// =========================================
// 6. Excel 功能
// =========================================
export function exportExcel(acc) {
  if (!acc) return;
  if (typeof XLSX === 'undefined') return showToast("❌ XLSX 套件未載入");
  const data = [
    ["計畫名稱", acc.name],
    ["美金匯率", acc.usdRate],
    ["可用現金", acc.currentCash],
    ["負債總額", acc.totalDebt],
    ["絕對門檻", acc.rebalanceAbs],
    ["相對門檻", acc.rebalanceRel],
    ["目標總槓桿", acc.targetExp || 1.0],
    [],
    ["代號", "標的全稱", "目前單價", "持有股數", "槓桿倍數", "目標權重%", "鎖定"],
  ];
  acc.assets.forEach((a) =>
    data.push([
      a.name, a.fullName || "", a.price, a.shares, a.leverage, a.targetRatio, a.isLocked ? "YES" : "NO",
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
  if (typeof XLSX === 'undefined') return showToast("❌ XLSX 套件未載入");
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const ab = evt.target.result;
      const wb = XLSX.read(ab, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (!rows[0] || rows[0][0] !== "計畫名稱") throw new Error("Excel 格式不正確");
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
      onComplete(newAcc);
      showToast(`✅ 已匯入計畫：「${newAcc.name}」`);
    } catch (err) {
      console.error(err);
      showToast("❌ 匯入失敗：" + err.message);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}