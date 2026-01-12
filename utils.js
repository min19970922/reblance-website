/**
 * utils.js - v79.0 強效解析版
 * 修正：
 * 1. 針對 "limit: 0" 錯誤，調整備援模型順序
 * 2. 新增 extractJSON 函式，用 Regex 暴力提取 JSON，解決 "| ID |..." 表格錯誤
 * 3. 圖片辨識維持 2.5 Flash 優先
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
    // 1. 嘗試直接解析
    return JSON.parse(text);
  } catch (e) {
    // 2. 如果失敗（例如回傳了 Markdown 表格），用 Regex 抓取第一個 {...} 或 [...]
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        // 忽略二次錯誤
      }
    }
    throw new Error("AI 回傳格式錯誤 (非 JSON)");
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

      // 如果是 Limit 0 或 429，視為失敗，進入下一個模型
      throw new Error(`Status ${response.status}: ${msg}`);
    } catch (err) {
      console.warn(`模型 ${model} 失敗:`, err);
      lastError = err;
      if (i === models.length - 1) break;
      await new Promise(r => setTimeout(r, 1000)); // 冷卻
    }
  }
  throw lastError;
}

async function internalFetch(url, payload) {
  // 基礎冷卻
  await new Promise(r => setTimeout(r, 800));
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// =========================================
// 4. AI 照片辨識
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

    const promptText = `Analyze table. Extract Stock Symbol (TICKER) and Shares.
    Important: If ticker is mixed with name (e.g. '00631L元大...'), extract ONLY '00631L'.
    JSON ONLY: {"assets": [{"name":"TICKER", "shares":100, "leverage":1.0}]}`;

    const payload = {
      contents: [{
        parts: [
          { text: promptText },
          { inline_data: { mime_type: "image/jpeg", data: base64Content } }
        ]
      }]
    };

    // 照片辨識：2.5 優先 (強)，Flash Latest 備援 (穩)
    const models = ["gemini-2.5-flash", "gemini-flash-latest"];

    const response = await fetchWithFallback(models, payload, apiKey);
    const result = await response.json();

    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 清理 markdown
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    showToast("⚡ 資料解析中 (3/3)...");

    if (text) {
      const parsedData = extractJSON(text); // 使用暴力解析
      const assets = parsedData.assets || [];

      const formattedAssets = assets.map((a) => {
        let rawName = (a.name || "").toString().toUpperCase().trim();
        const match = rawName.match(/^([A-Z0-9]+)/);
        const cleanName = match ? match[1] : rawName;

        return {
          id: Date.now() + Math.random(),
          name: cleanName,
          fullName: "---",
          price: 0,
          shares: Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0),
          leverage: parseFloat(a.leverage) || 1.0,
          targetRatio: 0,
          isLocked: false
        };
      }).filter(a => a.name.length >= 2);

      onComplete(formattedAssets);
      showToast(`✅ 辨識成功！發現 ${formattedAssets.length} 筆`);
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ 辨識失敗: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}

// =========================================
// 5. AI 智投建議 (強化解析)
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

  showToast(`🧠 AI 正在計算配置...`);

  const aiAssetsInfo = aiAssets.map(a =>
    `${a.name},${((parseFloat(a.bookValue) / data.netValue) * 100).toFixed(1)}%,${a.leverage}x`
  ).join("|");

  try {
    // 強化 Prompt：禁止 Markdown 表格
    const promptText = `Budget ${remainingBudget.toFixed(1)}%. Goal Lev ${targetExp}x.
    Rule: 1.Sum exact. 2.High lev priority if Goal>Now. 3.No average.
    OUTPUT RAW JSON ONLY. NO MARKDOWN TABLES. NO EXPLANATION.
    Data: [${aiAssetsInfo}]. 
    Format: {"suggestions":[{"name":"ID","targetRatio":20}]}`;

    const payload = { contents: [{ parts: [{ text: promptText }] }] };

    // 智投建議備援：Lite (快) -> Flash Latest (穩) -> Pro Latest (強)
    // 既然您的 2.0-flash 是 Limit 0，我們跳過它
    const models = [
      "gemini-2.0-flash-lite",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ];

    const response = await fetchWithFallback(models, payload, apiKey);
    const result = await response.json();

    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 初步清理
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      // ★ 使用 extractJSON 暴力解析，防止 "| ID |..." 表格導致 crash
      const parsedData = extractJSON(text);
      const suggestions = parsedData.suggestions || [];
      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);
      const factor = aiSum > 0 ? remainingBudget / aiSum : 1;

      onComplete(suggestions.map(s => ({
        name: s.name.toString().toUpperCase().trim(),
        targetRatio: Math.round(s.targetRatio * factor * 10) / 10,
      })));
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