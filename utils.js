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
/**
 * AI 照片辨識：強化槓桿因子自動識別 (v30.0)
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey || apiKey.length < 10) return showToast("❌ 請先設定並儲存 API Key");

  showToast("🚀 啟動 AI 視覺辨識中...");

  const fileToBase64 = (f) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
    });

  try {
    const base64Data = await fileToBase64(file);
    const base64Content = base64Data.split(",")[1];

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

    // 關鍵 Prompt 優化：要求識別槓桿因子 (leverage)
    const promptText = `你是一位專業量化分析師。請提取圖片中的持股代號(name)與股數(shares)。
    【加強要求】：請判斷標的是否為槓桿型產品。
    - 若為台股正2(如00631L, 00675L)或美股2倍槓桿(如TSLL)，leverage請給 2。
    - 若為一般股票或1倍ETF，leverage請給 1。
    注意：同一標的多筆出現請合併股數。
    格式範例：{"assets": [{"name":"00631L","shares":5000,"leverage":2}]}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: file.type || "image/png",
                data: base64Content
              }
            }
          ]
        }]
      })
    });

    if (!response.ok) throw new Error(`API 請求失敗 (${response.status})`);

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const parsed = JSON.parse(text);
      const rawAssets = parsed.assets || [];
      const mergedMap = new Map();

      rawAssets.forEach((a) => {
        const name = (a.name || "").toString().toUpperCase().trim();
        const shares = Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0);
        const leverage = parseFloat(a.leverage) || 1; // 接收 AI 識別的槓桿
        if (name && shares > 0) {
          if (!mergedMap.has(name)) {
            mergedMap.set(name, { shares, leverage });
          } else {
            const existing = mergedMap.get(name);
            mergedMap.set(name, { shares: existing.shares + shares, leverage });
          }
        }
      });

      const formattedAssets = Array.from(mergedMap.entries()).map(([name, info]) => ({
        id: Date.now() + Math.random(),
        name,
        fullName: "---",
        price: 0,
        shares: info.shares,
        leverage: info.leverage, // 自動代入槓桿數字
        targetRatio: 0,
        isLocked: false
      }));

      if (formattedAssets.length > 0) {
        onComplete(formattedAssets);
        showToast(`✅ 辨識成功！發現 ${formattedAssets.length} 筆資產(含槓桿識別)`);
      } else {
        showToast("⚠️ 未能在圖片中發現持股數據");
      }
    }
  } catch (err) {
    console.error("辨識錯誤:", err);
    showToast(`❌ 辨識失敗: ${err.message}`);
  } finally {
    e.target.value = "";
  }
}
/**
 * AI 智投強化版 (v30.0) - 金融邏輯注入
 */
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請先設定 API Key");

  const data = calculateAccountData(acc);
  const netValue = data.netValue;

  // 1. 金融大師邏輯：精確計算「待分配預算」
  const lockedTotal = acc.assets.reduce((s, a) => s + (a.isLocked ? safeNum(a.targetRatio) : 0), 0) + safeNum(acc.cashRatio);
  const remainingBudget = Math.max(0, 100 - lockedTotal);

  if (remainingBudget <= 0) return showToast("❌ 預算已滿 (鎖定資產與現金已達 100%)");

  // 2. 準備上下文：包含標的之目前占比與槓桿因子
  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 找不到未鎖定的標的供 AI 規劃");

  const aiAssetsInfo = aiAssets.map((a) => {
    const currentPct = netValue > 0 ? (safeNum(a.nominalValue) / netValue) * 100 : 0;
    return `- ${a.name}(${a.fullName || "---"}): 目前權重 ${currentPct.toFixed(1)}%, 槓桿因子 ${a.leverage}x`;
  }).join("\n");

  showToast(`🧠 AI 智投規劃中 (待分配: ${remainingBudget.toFixed(1)}%)...`);

  try {
    // 3. 強化型 Prompt：要求達成總槓桿目標且最小化變動
    const promptText = `你是一位專業的量化基金經理。
    【核心任務】請規劃投資組合的「目標比例(targetRatio)」，讓帳戶總名目曝險達成淨值的 ${targetExp}x。
    
    【約束條件】
    1. 固定預算：現金與鎖定資產已佔用 ${lockedTotal.toFixed(1)}% 比例，不可更動。
    2. 分配預算：你必須將剩餘的 ${remainingBudget.toFixed(1)}% 比例，完全分配給待規劃標的。
    3. 歸一化要求：分配後的 targetRatio 總和必須「精確等於」 ${remainingBudget.toFixed(1)}。
    4. 最小化變動：參考「目前權重」進行微調，除非為了達成 ${targetExp}x 槓桿目標，否則避免大幅換倉。
    5. 嚴格要求：清單中每個標的都必須獲得分配，分配比例不得為 0。

    【待規劃標的清單】：
    ${aiAssetsInfo}
    
    請僅回傳 JSON 格式：{"suggestions": [{"name": "代號", "targetRatio": 15.5}]}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
    });

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      let suggestions = JSON.parse(text).suggestions || [];

      // 4. 程式大師邏輯：強制歸一化處理，確保總和絕對等於 remainingBudget
      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);
      if (aiSum <= 0) throw new Error("AI 回傳無效比例");

      const factor = remainingBudget / aiSum;
      const finalSuggestions = suggestions.map((sug) => ({
        name: sug.name,
        targetRatio: Math.round(sug.targetRatio * factor * 10) / 10, // 保留一位小數
      }));

      onComplete(finalSuggestions);
    }
  } catch (err) {
    console.error(err);
    showToast(`❌ AI 配置失敗: ${err.message}`);
  }
}