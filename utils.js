/**
 * utils.js - 2026 清單專用穩定版 (v71.0)
 * 核心策略：
 * 1. 鎖定 gemini-2.0-flash-001 (清單 Index 5) -> 解決 404/400
 * 2. 使用 PNG 格式 -> 解決圖片解析錯誤
 * 3. 每日配額 1500 次 -> 解決 429
 */
import { safeNum, calculateAccountData } from "./state.js";
import { showToast } from "./ui.js";

// =========================================
// 1. 圖片壓縮 (改用 PNG 格式)
// =========================================
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      // 限制長邊 1024px (Token 防禦)
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
      // ★ 改用 PNG，對文字辨識相容性更好
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (err) => reject(err);
  });
};

// =========================================
// 2. 重試機制 (顯示真實錯誤)
// =========================================
async function fetchWithRetry(url, options, retries = 1, delay = 2000) {
  const res = await fetch(url, options);

  // 如果是 429 (太快)，等待後重試
  if (res.status === 429 && retries > 0) {
    showToast(`⏳ 伺服器忙碌，${delay / 1000}秒後重試...`);
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }

  return res;
}

// =========================================
// 3. AI 照片辨識 (使用 2.0 Flash 001)
// =========================================
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  showToast("🔄 讀取並壓縮圖片 (1/3)...");

  try {
    const compressedBase64 = await compressImage(file);
    const base64Content = compressedBase64.split(",")[1];

    showToast("🤖 AI (2.0 Flash 001) 分析中... (2/3)");

    // ★★★ 核心修正：鎖定清單 Index 5 (gemini-2.0-flash-001) ★★★
    // 這是目前唯一確認：1. 存在清單中 2. 支援圖片 3. 配額正常 的模型
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${apiKey}`;

    const promptText = `Analyze table. Extract stock name and shares.
    Rule: If name contains '正2','2X','L', set leverage=2.0. Else 1.0.
    JSON ONLY: {"assets": [{"name":"TICKER", "shares":100, "leverage":1.0}]}`;

    // 強制冷卻 1 秒
    await new Promise(r => setTimeout(r, 1000));

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inline_data: { mime_type: "image/png", data: base64Content } }
          ]
        }]
      })
    });

    if (!response.ok) {
      // ★ 讀取真實錯誤訊息，方便除錯 ★
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || "未知錯誤";

      if (response.status === 400) throw new Error(`圖片格式不被支援: ${errMsg}`);
      if (response.status === 404) throw new Error("模型不存在 (404)");
      if (response.status === 429) throw new Error("配額已滿 (請更換 Key)");
      throw new Error(`API 錯誤 (${response.status}): ${errMsg}`);
    }

    showToast("⚡ 資料整理中... (3/3)");

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const parsedData = JSON.parse(text);
      const assets = parsedData.assets || [];
      const formattedAssets = assets.map((a) => ({
        id: Date.now() + Math.random(),
        name: (a.name || "").toString().toUpperCase().trim(),
        fullName: "---",
        price: 0,
        shares: Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0),
        leverage: parseFloat(a.leverage) || 1.0,
        targetRatio: 0,
        isLocked: false
      })).filter(a => a.name.length >= 2);

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
// 4. AI 智投建議 (同步使用 2.0 Flash 001)
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

  showToast(`🧠 AI (2.0 Flash) 正在計算配置...`);

  const aiAssetsInfo = aiAssets.map(a =>
    `${a.name},${((parseFloat(a.bookValue) / data.netValue) * 100).toFixed(1)}%,${a.leverage}x`
  ).join("|");

  try {
    const promptText = `Budget ${remainingBudget.toFixed(1)}%. Goal Lev ${targetExp}x.
    Rule: 1.Sum exact. 2.High lev priority if Goal>Now. 3.No average.
    Data: [${aiAssetsInfo}]. JSON: {"suggestions":[{"name":"ID","targetRatio":20}]}`;

    // 同步修正為 2.0 Flash 001
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${apiKey}`;

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });

    if (!response.ok) throw new Error(`API 錯誤: ${response.status}`);

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
    showToast(`❌ 智投失敗: ${err.message}`);
  }
}

// 5. Excel 功能 (請將原有的 exportExcel/importExcel 貼在下方)
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