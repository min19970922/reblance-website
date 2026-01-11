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

    const promptText = `你是一位專業分析師。請提取圖片中的持股代號(name)與股數(shares)。
    注意：如果同一個標的出現多次（例如包含「現買」與「擔保品」），請務必將股數相加合併為一筆。
    請嚴格只回傳 JSON 格式，不要有任何解釋文字。
    格式範例：{"assets": [{"name":"2317","shares":14349}]}`;

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

      // 二次強制合併邏輯：處理同一代號的不同股數
      rawAssets.forEach((a) => {
        const name = (a.name || "").toString().toUpperCase().trim();
        const shares = Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0);
        if (name && shares > 0) {
          mergedMap.set(name, (mergedMap.get(name) || 0) + shares);
        }
      });

      const formattedAssets = Array.from(mergedMap.entries()).map(([name, shares]) => ({
        id: Date.now() + Math.random(),
        name,
        fullName: "---",
        price: 0,
        shares,
        leverage: 1,
        targetRatio: 0,
        isLocked: false
      }));

      if (formattedAssets.length > 0) {
        onComplete(formattedAssets);
        showToast(`✅ 辨識成功！發現 ${formattedAssets.length} 筆資產`);
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
 * AI 智投建議：強化歸一化與鎖定保護
 */
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請先設定 API Key");

  const data = calculateAccountData(acc);
  const netValue = data.netValue;

  // 1. 計算剩餘預算：排除已鎖定的標的與現金比例
  const lockedTotal = acc.assets.reduce((s, a) => s + (a.isLocked ? a.targetRatio : 0), 0) + acc.cashRatio;
  const remainingBudget = Math.max(0, 100 - lockedTotal);

  if (remainingBudget <= 0) return showToast("❌ 剩餘預算不足 (鎖定資產已達 100%)");

  // 2. 獲取「未鎖定」的資產作為 AI 分配對象
  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 找不到未鎖定的標的供 AI 規劃");

  const aiAssetsInfo = aiAssets.map((a) => {
    const currentPct = netValue > 0 ? (a.nominalValue / netValue) * 100 : 0;
    return `- ${a.name}(${a.fullName}): 目前權重 ${currentPct.toFixed(1)}%, 槓桿因子 ${a.leverage}x`;
  }).join("\n");

  showToast(`🧠 AI 智投規劃中 (預算: ${remainingBudget.toFixed(1)}%)...`);

  try {
    const promptText = `你是一位專業的基金經理。
    【目標】總實質槓桿達成 ${targetExp}x。
    【約束】
    1. 現金與鎖定資產已佔用 ${lockedTotal.toFixed(1)}% 比例。
    2. 你必須將剩餘的 ${remainingBudget.toFixed(1)}% 比例，完全分配給下列標的。
    3. 嚴格要求：清單中的「每一個」標的都必須獲得分配，分配比例不得為 0。
    4. 所有建議的 targetRatio 總和必須精確等於 ${remainingBudget.toFixed(1)}。
    
    【待規劃清單】：
    ${aiAssetsInfo}
    
    請參考目前權重進行再平衡優化，不要大幅換倉。只回傳 JSON 格式：{"suggestions": [{"name": "代號", "targetRatio": 12.5}]}`;

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

      // 強制歸一化邏輯：確保 AI 建議總和完全符合剩餘預算
      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);
      if (aiSum <= 0) throw new Error("AI 回傳無效比例");

      const factor = remainingBudget / aiSum;
      const finalSuggestions = suggestions.map((sug) => ({
        name: sug.name,
        targetRatio: Math.round(sug.targetRatio * factor * 10) / 10,
      }));

      onComplete(finalSuggestions);
    }
  } catch (err) {
    showToast(`❌ AI 配置失敗: ${err.message}`);
  }
}