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
 * AI 智投強化版 (v32.5) 
 * 解決：匹配失敗、平均分配、429 頻率限制報錯、及歸一化精準度
 */
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  const data = calculateAccountData(acc);

  // 1. 精確計算預算：100% - 鎖定% - 現金%
  const lockedTotal = acc.assets.reduce((s, a) => s + (a.isLocked ? safeNum(a.targetRatio) : 0), 0) + safeNum(acc.cashRatio);
  const remainingBudget = Math.max(0, 100 - lockedTotal);

  if (remainingBudget <= 0) return showToast("❌ 預算已滿 (鎖定項與現金已達 100%)");

  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 找不到可規劃標的 (請檢查是否全部鎖定)");

  // 2. 準備上下文：讓 AI 看到「現況」與「目標」的差距
  const currentTotalLev = data.totalLeverage || 1.0;
  const aiAssetsInfo = aiAssets.map((a) => {
    // 這裡使用 bookValue (淨值) 計算目前的資金占比，確保與 targetRatio 邏輯一致
    const currentPct = data.netValue > 0 ? (safeNum(a.bookValue) / data.netValue) * 100 : 0;
    return `- 代號: ${a.name}, 目前權重: ${currentPct.toFixed(1)}%, 標的倍數: ${a.leverage}x`;
  }).join("\n");

  showToast(`🧠 正在根據 ${targetExp}x 目標優化權重...`);

  try {
    const promptText = `你是一位專業的量化基金經理。
    【背景】帳戶目前實質槓桿 ${currentTotalLev.toFixed(2)}x，目標是達成 ${targetExp}x。
    【任務】請分配剩餘的 ${remainingBudget.toFixed(1)}% 預算給待規劃標的。
    【分配準則】
    1. 必須將 ${remainingBudget.toFixed(1)}% 全部用完，targetRatio 總和需精確。
    2. 槓桿導向：若目標槓桿 > 目前，請優先加碼「標的倍數」高的標的；反之則減碼。
    3. 拒絕平均分配：請根據倍數差異化配置權重。
    4. 穩定性：參考目前權重微調，避免無意義的大幅換倉。
    5. 回傳代號必須與清單完全一致。
    
    請嚴格只回傳 JSON：{"suggestions": [{"name": "代號", "targetRatio": 數值}]}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });

    // 處理 429 頻率限制
    if (!response.ok) {
      if (response.status === 429) throw new Error("API 請求太頻繁，請等待 1 分鐘後再試");
      throw new Error(`API 請求失敗: ${response.status}`);
    }

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const suggestions = JSON.parse(text).suggestions || [];
      const aiSum = suggestions.reduce((s, a) => s + parseFloat(a.targetRatio || 0), 0);

      if (aiSum <= 0) throw new Error("AI 回傳無效建議");

      // 3. 強制歸一化：確保結果總和絕對等於 remainingBudget
      const factor = remainingBudget / aiSum;
      const finalSuggestions = suggestions.map((sug) => ({
        // 模糊匹配處理：統一格式以利 main.js 匹配
        name: sug.name.toString().toUpperCase().trim(),
        targetRatio: Math.round(sug.targetRatio * factor * 10) / 10,
      }));

      onComplete(finalSuggestions);
    }
  } catch (err) {
    console.error("AI 智投錯誤:", err);
    showToast(`❌ 智投失敗: ${err.message}`);
  }
}