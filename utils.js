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
 * utils.js - 智投穩定版 (v50.0)
 * 解決 429 配額限制，針對 2026 模型清單進行路徑優化
 */
export async function importFromImage(e, onComplete) {
  const file = e.target.files[0];
  if (!file) return;

  const showToast = window.showToast || console.log;
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");

  if (!apiKey || apiKey.length < 10) {
    showToast("❌ 請先設定並儲存 API Key");
    e.target.value = "";
    return;
  }

  showToast("🚀 啟動 AI 視覺辨識中...");

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

  // 指數退避重試函式，避免連續點擊導致 429 加劇
  async function fetchWithRetry(url, options, retries = 2, delay = 5000) {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      showToast(`⏳ AI 忙碌，${delay / 1000}秒後自動重試...`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    return res;
  }

  try {
    const base64Image = await fileToBase64(file);

    // --- 關鍵修正：使用您 2026 清單中負擔最輕的 Lite 模型 ---
    const model = "gemini-2.0-flash-lite";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // 極簡化指令：降低 Token 消耗，防止觸發 TPM 限制
    const promptText = `Extract JSON: {"assets":[{"name":"TICKER","shares":100}]}.`;

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

    // 請求前強制冷卻 1 秒，避開 RPM 偵測
    await new Promise(r => setTimeout(r, 1000));

    const response = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json();
      if (response.status === 429) {
        throw new Error("API 配額已乾涸。請更換 API Key 或將圖片裁減縮小後再試。");
      }
      throw new Error(errData.error?.message || `請求失敗 (${response.status})`);
    }

    const result = await response.json();
    let text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    if (text) {
      const parsedData = JSON.parse(text);
      const assets = parsedData.assets || [];

      if (assets.length > 0) {
        const formattedAssets = assets.map((a) => ({
          id: Date.now() + Math.random(),
          name: (a.name || "").toString().toUpperCase().trim(),
          fullName: "---",
          price: 0,
          shares: Math.abs(parseInt(a.shares.toString().replace(/,/g, "")) || 0),
          leverage: 1, // 預設 1x，若有需要可在此加入槓桿判斷邏輯
          targetRatio: 0,
          isLocked: false
        })).filter((a) => a.name.length >= 2 && a.shares > 0);

        onComplete(formattedAssets);
        showToast(`✅ 辨識成功！發現 ${formattedAssets.length} 筆資產`);
      } else {
        showToast("AI 未能辨識出有效內容");
      }
    }
  } catch (err) {
    console.error("AI辨識錯誤:", err);
    showToast(`❌ ${err.message}`);
  } finally {
    e.target.value = "";
  }
}
/**
 * AI 智投建議 - 終極穩定配額版 (v45.0)
 * 解決 429 (Too Many Requests) 報錯
 * 1. 使用 gemini-1.5-flash 避開 2.0 系列的 0 配額封鎖
 * 2. 指令極簡化，節省 Token 消耗
 */
export async function generateAiAllocation(acc, targetExp, onComplete) {
  const apiKey = window.GEMINI_API_KEY || localStorage.getItem("GEMINI_API_KEY");
  if (!apiKey) return showToast("❌ 請設定 API Key");

  const data = calculateAccountData(acc);
  const lockedTotal = acc.assets.reduce((s, a) => s + (a.isLocked ? parseFloat(a.targetRatio || 0) : 0), 0) + parseFloat(acc.cashRatio || 0);
  const remainingBudget = Math.max(0, 100 - lockedTotal);

  if (remainingBudget <= 0) return showToast("❌ 預算已滿");

  const aiAssets = acc.assets.filter((a) => !a.isLocked);
  if (aiAssets.length === 0) return showToast("❌ 無未鎖定標的");

  async function fetchWithRetry(url, options, retries = 2, backoff = 10000) {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      showToast(`⏳ AI 忙碌，${backoff / 1000}秒後自動重試...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return res;
  }

  try {
    const aiAssetsInfo = aiAssets.map(a => `${a.name},${a.leverage}x`).join("|");

    // 極簡提示詞，降低 TP (Tokens per Request)
    const promptText = `Assign ${remainingBudget.toFixed(1)}% weight. Goal: Total Leverage ${targetExp}x. Data: [${aiAssetsInfo}]. JSON ONLY: {"suggestions": [{"name":"TICKER","targetRatio":20}]}`;

    // --- 核心修正：換成 1.5 穩定版路徑 ---
    const model = "gemini-1.5-flash";
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
      if (response.status === 429) {
        throw new Error("AI 配額已滿，請等待 1 分鐘後再試。");
      }
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
    showToast(`❌ AI 建議暫時失效: ${err.message}`);
  }
}