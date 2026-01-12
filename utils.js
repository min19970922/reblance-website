/**
 * utils.js - 智慧備援版 (v78.0)
 * 策略：
 * 1. 實作「多模型自動切換 (Failover)」，遇到 429 自動換模型
 * 2. 內建代號清洗 (Regex)，解決 API 404 錯誤
 * 3. 圖片壓縮與重試機制
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
// 2. 智慧請求函式 (含備援邏輯)
// =========================================
async function fetchWithFallback(models, payload, apiKey) {
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // 顯示嘗試訊息
    if (i > 0) showToast(`⚠️ 通道 ${i} 擁塞，切換至備用線路 (${model})...`);

    try {
      // 每個請求給予 1 次內部重試機會
      const response = await internalFetch(url, payload);
      if (response.ok) return response; // 成功則直接回傳

      // 若失敗，拋出錯誤進入 catch
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Status ${response.status}: ${errData.error?.message || "Unknown"}`);
    } catch (err) {
      console.warn(`模型 ${model} 失敗:`, err);
      lastError = err;
      // 如果是最後一個模型，則不再重試
      if (i === models.length - 1) break;
      // 切換前稍作冷卻
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw lastError;
}

// 內部單次請求 (含簡單延遲)
async function internalFetch(url, payload) {
  // 強制冷卻 1 秒
  await new Promise(r => setTimeout(r, 1000));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  // 如果遇到 429，內部等待 2 秒再試一次 (僅限一次)
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  return res;
}

// =========================================
// 3. AI 照片辨識 (雙重備援)
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
    Rule: If name contains '正2','2X','L', set leverage=2.0. Else 1.0.
    JSON ONLY: {"assets": [{"name":"TICKER", "shares":100, "leverage":1.0}]}`;

    const payload = {
      contents: [{
        parts: [
          { text: promptText },
          { inline_data: { mime_type: "image/jpeg", data: base64Content } }
        ]
      }]
    };

    // ★★★ 備援清單：優先用 2.5 (強)，失敗用 2.0 (穩) ★★★
    const models = ["gemini-2.5-flash", "gemini-2.0-flash"];

    const response = await fetchWithFallback(models, payload, apiKey);
    const result = await response.json();

    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    showToast("⚡ 資料解析中 (3/3)...");

    if (text) {
      const parsedData = JSON.parse(text);
      const assets = parsedData.assets || [];

      const formattedAssets = assets.map((a) => {
        // ★ 自動清洗代號邏輯 (保留) ★
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
// 4. AI 智投建議 (三重備援)
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

  showToast(`🧠 AI 正在計算配置 (自動尋找可用線路)...`);

  const aiAssetsInfo = aiAssets.map(a =>
    `${a.name},${((parseFloat(a.bookValue) / data.netValue) * 100).toFixed(1)}%,${a.leverage}x`
  ).join("|");

  try {
    const promptText = `Budget ${remainingBudget.toFixed(1)}%. Goal Lev ${targetExp}x.
    Rule: 1.Sum exact. 2.High lev priority if Goal>Now. 3.No average.
    Data: [${aiAssetsInfo}]. JSON: {"suggestions":[{"name":"ID","targetRatio":20}]}`;

    const payload = { contents: [{ parts: [{ text: promptText }] }] };

    // ★★★ 備援清單：標準 -> 舊版 -> 輕量 ★★★
    // 這樣能最大程度避開 429
    const models = [
      "gemini-2.0-flash",       // 首選：標準版 (1500次/天)
      "gemini-flash-latest",    // 次選：舊版穩定通道
      "gemini-2.0-flash-lite"   // 最後：輕量版 (容易塞車，但可當備案)
    ];

    const response = await fetchWithFallback(models, payload, apiKey);
    const result = await response.json();

    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const suggestions = JSON.parse(text).suggestions || [];
      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);
      const factor = aiSum > 0 ? remainingBudget / aiSum : 1;

      onComplete(suggestions.map(s => ({
        name: s.name.toString().toUpperCase().trim(),
        targetRatio: Math.round(s.targetRatio * factor * 10) / 10,
      })));
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ 智投失敗 (全線路忙碌): ${err.message}`);
  }
}

// =========================================
// 5. Excel 功能 (保持原樣)
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