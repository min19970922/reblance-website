/**
 * main.js - 核心邏輯鎖定增強版 (v26.0)
 * 整合：全域函式掛載、頂部參數區連動、鎖定功能、以及 AI 智投建議排除邏輯
 */
import {
  appState,
  saveToStorage,
  loadFromStorage,
  initialAccountTemplate,
  safeNum,
} from "./state.js";
import {
  renderMainUI,
  renderAccountList,
  toggleSidebarUI,
  showToast,
} from "./ui.js";
import { syncAllPrices, fetchLivePrice } from "./api.js";
import {
  exportExcel,
  importExcel,
  importFromImage,
  generateAiAllocation,
} from "./utils.js";

/**
 * 系統初始化
 */
function init() {
  loadFromStorage();

  // 將 UI 通知函式掛載至 window 供其他模組調用
  window.renderMainUI = renderMainUI;
  window.showToast = showToast;

  // 確保有有效的啟動計畫
  if (
    !appState.activeId ||
    !appState.accounts.find((a) => a.id === appState.activeId)
  ) {
    appState.activeId = appState.accounts[0].id;
  }

  // 側邊欄狀態恢復
  if (appState.isSidebarCollapsed) toggleSidebarUI(true);

  refreshAll();
  bindGlobalEvents();
}

/**
 * 刷新全域 UI 並重新綁定標題點擊事件
 */
function refreshAll() {
  const activeAcc = appState.accounts.find((a) => a.id === appState.activeId);
  if (!activeAcc) return;

  renderAccountList(appState, "switchAccount", "deleteAccount");
  renderMainUI(activeAcc);

  // 計畫名稱修改邏輯
  const titleEl = document.getElementById("activeAccountTitle");
  if (titleEl) {
    titleEl.onclick = () => {
      const newName = prompt("請輸入新的計畫名稱:", activeAcc.name);
      if (newName && newName.trim() !== "") {
        activeAcc.name = newName.trim();
        saveToStorage();
        refreshAll();
        showToast("名稱已更新");
      }
    };
  }

  // 同步目標總槓桿輸入框數值 (位於看板卡片內)
  const targetExpInput = document.getElementById("targetExpInput");
  if (targetExpInput) {
    targetExpInput.value = activeAcc.targetExp || 1.0;
  }
}

// --- 全域函式掛載區 (供 HTML inline 事件呼叫) ---

window.switchAccount = (id) => {
  appState.activeId = id;
  saveToStorage();
  refreshAll();
};

window.deleteAccount = (id) => {
  if (appState.accounts.length <= 1) return showToast("至少需保留一個計畫");
  if (confirm("確定要刪除此計畫嗎？")) {
    appState.accounts = appState.accounts.filter((a) => a.id !== id);
    appState.activeId = appState.accounts[0].id;
    saveToStorage();
    refreshAll();
  }
};

/**
 * 切換資產鎖定狀態
 */
window.toggleLock = (id) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  const asset = acc.assets.find((as) => as.id === id);
  if (asset) {
    asset.isLocked = !asset.isLocked;
    saveToStorage();
    refreshAll();
    showToast(asset.isLocked ? `已鎖定 ${asset.name}` : `已解鎖 ${asset.name}`);
  }
};

/**
 * 更新全域參數 (包含目標槓桿、現金比例等)
 */
window.updateGlobal = (key, val) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  if (acc) {
    acc[key] = safeNum(val);
    saveToStorage();
    refreshAll();
  }
};

/**
 * 更新單一資產欄位
 */
window.updateAsset = (id, key, val) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  const asset = acc.assets.find((as) => as.id === id);
  if (asset) {
    asset[key] = key === "name" ? val.toUpperCase().trim() : safeNum(val);
    saveToStorage();

    if (key === "name" && asset.name.length >= 4) {
      window.fetchLivePrice(id, asset.name);
    } else {
      refreshAll();
    }
  }
};

window.moveAsset = (assetId, direction) => {
  // 修正：應尋找目前啟動中的帳戶，而不是用 assetId 去找帳戶
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  if (!acc) return;

  const index = acc.assets.findIndex((a) => a.id === assetId);
  const newIndex = index + direction;

  if (newIndex >= 0 && newIndex < acc.assets.length) {
    [acc.assets[index], acc.assets[newIndex]] = [
      acc.assets[newIndex],
      acc.assets[index],
    ];
    saveToStorage();
    refreshAll();
  }
};

window.removeAsset = (id) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  acc.assets = acc.assets.filter((a) => a.id !== id);
  saveToStorage();
  refreshAll();
};

window.fetchLivePrice = (id, symbol) => {
  fetchLivePrice(id, symbol, appState);
};

// --- DOM 事件綁定 ---
function bindGlobalEvents() {
  const btnToggle = document.getElementById("btnToggleSidebar");
  if (btnToggle) {
    btnToggle.onclick = () => {
      appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
      toggleSidebarUI(appState.isSidebarCollapsed);
      saveToStorage();
    };
  }

  const btnCreate = document.getElementById("btnCreateAccount");
  if (btnCreate) {
    btnCreate.onclick = () => {
      const name = prompt("計畫名稱:", "新計畫");
      if (!name) return;
      const newAcc = initialAccountTemplate(name);
      appState.accounts.push(newAcc);
      window.switchAccount(newAcc.id);
    };
  }

  const btnDelete = document.getElementById("btnDeleteAccount");
  if (btnDelete) {
    btnDelete.onclick = () => window.deleteAccount(appState.activeId);
  }

  const btnExport = document.getElementById("btnExport");
  if (btnExport) {
    btnExport.onclick = () => {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      exportExcel(acc);
    };
  }

  const inputImport = document.getElementById("inputImport");
  if (inputImport) {
    inputImport.onchange = (e) => {
      importExcel(e, (newAcc) => {
        appState.accounts.push(newAcc);
        window.switchAccount(newAcc.id);
      });
    };
  }

  const inputCamera = document.getElementById("inputCamera");
  if (inputCamera) {
    inputCamera.onchange = (e) => {
      importFromImage(e, (newAssets) => {
        const acc = appState.accounts.find((a) => a.id === appState.activeId);
        newAssets.forEach((asset) => {
          const existing = acc.assets.find((a) => a.name === asset.name);
          if (existing) {
            existing.shares = asset.shares;
          } else {
            acc.assets.push(asset);
          }
        });
        saveToStorage();
        refreshAll();
        syncAllPrices(appState);
      });
    };
  }


  // AI 智投建議配置按鈕 (優化版：防止連續點擊觸發 429 錯誤)
  const btnAiOptimize = document.getElementById("btnAiOptimize");
  let isAiProcessing = false; // 狀態鎖定旗標

  if (btnAiOptimize) {
    btnAiOptimize.onclick = async () => {
      // 防止重複點擊
      if (isAiProcessing) return;

      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      if (!acc) return;

      const targetExp = acc.targetExp || 1.0;

      // 進入處理狀態
      isAiProcessing = true;
      btnAiOptimize.disabled = true;
      btnAiOptimize.classList.add("opacity-50", "cursor-not-allowed");
      btnAiOptimize.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 計算中...`;

      try {
        await generateAiAllocation(acc, targetExp, (suggestions) => {
          suggestions.forEach((sug) => {
            // 模糊匹配邏輯：確保代號能對應
            const asset = acc.assets.find((a) =>
              a.name.toUpperCase().includes(sug.name) ||
              sug.name.includes(a.name.toUpperCase())
            );
            if (asset && !asset.isLocked) {
              asset.targetRatio = sug.targetRatio;
            }
          });
          saveToStorage();
          refreshAll();
          showToast(`✅ 已根據 ${targetExp}x 目標優化權重`);
        });
      } catch (err) {
        // 錯誤訊息通常已在 generateAiAllocation 顯示 toast
        console.error("AI 智投執行失敗:", err);
      } finally {
        // 解除鎖定
        isAiProcessing = false;
        btnAiOptimize.disabled = false;
        btnAiOptimize.classList.remove("opacity-50", "cursor-not-allowed");
        btnAiOptimize.innerHTML = `<i class="fas fa-robot"></i> AI 智投建議`;
      }
    };
  }
  document.getElementById("btnSyncAll").onclick = () => syncAllPrices(appState);

  document.getElementById("btnAddAsset").onclick = () => {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    acc.assets.push({
      id: Date.now(),
      name: "",
      fullName: "---",
      price: 0,
      shares: 0,
      targetRatio: 0,
      leverage: 1,
      isLocked: false, // 預設不鎖定
    });
    refreshAll();
  };
}

init();
