/**
 * utils.js - 終極穩定整合版 (v62.0)
 * 整合：Excel 處理、圖片壓縮、AI 視覺辨識、AI 智投建議
 */
import { safeNum, calculateAccountData } from "./state.js";
import { showToast } from "./ui.js";

// =========================================
// A. 基礎輔助工具 (圖片壓縮與 API 重試)
// =========================================

/**
 * 圖片壓縮：限制長邊 1024px，質量 0.6
 */
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

/**
 * 強化版 API 請求：自動處理 429 頻率限制
 */
async function fetchWithRetry(url, options, retries = 2, delay = 5000) {
  const res = await fetch(url, options);
  if (res.status === 429 && retries > 0) {
    showToast(`⏳ 伺服器忙碌，${delay / 1000}秒後重試 (剩餘 ${retries} 次)...`);
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, options, retries - 1, delay * 2); // 每次重試時間加倍
  }
  return res;
}

/**
 * 清理 AI 回傳的 JSON 格式
 */
function cleanJsonString(str) {
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
}

// =========================================
// B. Excel 功能 (匯出 / 匯入)
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

      if (!rows[0] || rows[0][0] !== "計畫名稱") throw new Error("非本系統匯出檔案格式");

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
            name: r[0].toString().toUpperCase().trim(),
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
      showToast("❌ 匯入失敗：" + err.message);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

// =========================================
// C. AI 功能 (視覺辨識與智投建議)
// =========================================

export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請先設定並儲存 API Key");

  showToast("🔄 圖片壓縮中 (1/3)...");

  try {
    const compressedBase64 = await compressImage(file);
    const base64Content = compressedBase64.split(",")[1];

    showToast("🤖 AI 分析中 (2/3)...");

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const promptText = `Analyze stock portfolio table. Extract ticker and shares. 
    If name contains '正2','2X','L', set leverage=2.0, else 1.0.
    JSON ONLY: {"assets": [{"name":"2330", "shares":1000, "leverage":1.0}]}`;

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inline_data: { mime_type: "image/jpeg", data: base64Content } }
          ]
        }]
      })
    });

    if (!response.ok) throw new Error(`API 錯誤: ${response.status}`);

    showToast("⚡ 資料整理中 (3/3)...");
    const result = await response.json();
    let text = cleanJsonString(result.candidates?.[0]?.content?.parts?.[0]?.text || "");

    if (text) {
      const parsed = JSON.parse(text);
      const assets = (parsed.assets || []).map(a => ({
        id: Date.now() + Math.random(),
        name: (a.name || "").toString().toUpperCase().trim(),
        fullName: "---",
        price: 0,
        shares: Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0),
        leverage: parseFloat(a.leverage) || 1.0,
        targetRatio: 0,
        isLocked: false
      })).filter(a => a.name.length >= 2);

      onComplete(assets);
      showToast(`✅ 辨識完成，發現 ${assets.length} 筆`);
    }
  } catch (err) {
    showToast(`❌ 辨識失敗: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}

export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  const data = calculateAccountData(acc);
  const lockedRatio = acc.assets.reduce((s, a) => s + (a.isLocked ? parseFloat(a.targetRatio || 0) : 0), 0);
  const remainingBudget = Math.max(0, 100 - lockedRatio - parseFloat(acc.cashRatio || 0));

  if (remainingBudget <= 0) return showToast("❌ 預算已分配完畢");
  const aiAssets = acc.assets.filter(a => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 無未鎖定標的");

  showToast(`🧠 AI 正在計算優化權重...`);

  const assetsInfo = aiAssets.map(a =>
    `${a.name},目前${((parseFloat(a.bookValue) / data.netValue) * 100).toFixed(1)}%,槓桿${a.leverage}x`
  ).join("|");

  try {
    const promptText = `Budget:${remainingBudget.toFixed(1)}%. Portfolio Target Leverage:${targetExp}x.
    Distribute budget to assets based on their leverage to meet goal.
    JSON ONLY: {"suggestions":[{"name":"ID","targetRatio":20}]}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });

    if (!response.ok) throw new Error(`API 錯誤: ${response.status}`);

    const result = await response.json();
    let text = cleanJsonString(result.candidates?.[0]?.content?.parts?.[0]?.text || "");

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
    showToast(`❌ AI 建議暫時失效: ${err.message}`);
  }
}