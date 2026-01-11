/**
 * main.js - 核心邏輯終極版 (v15.0)
 * 整合：全域函式掛載、頂部參數區連動、AI 合併後自動價格同步
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
import { exportExcel, importExcel, importFromImage } from "./utils.js";

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
 * 更新頂部參數區 (包含現金比例、負債、現金餘額等)
 */
window.updateGlobal = (key, val) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  if (acc) {
    acc[key] = safeNum(val);
    saveToStorage();
    refreshAll(); // 關鍵：參數改變後必須立即重新計算 Dashboard 與標的目前%
  }
};

/**
 * 更新標的單列數據
 */
window.updateAsset = (id, key, val) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  const asset = acc.assets.find((as) => as.id === id);
  if (asset) {
    // 處理代號轉換大寫
    asset[key] = key === "name" ? val.toUpperCase().trim() : safeNum(val);
    saveToStorage();

    // 如果修改的是名稱/代號且長度符合，觸發單一報價同步
    if (key === "name" && asset.name.length >= 4) {
      window.fetchLivePrice(id, asset.name);
    } else {
      refreshAll();
    }
  }
};

window.moveAsset = (assetId, direction) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
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
  // 側邊欄切換
  const btnToggle = document.getElementById("btnToggleSidebar");
  if (btnToggle) {
    btnToggle.onclick = () => {
      appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
      toggleSidebarUI(appState.isSidebarCollapsed);
      saveToStorage();
    };
  }

  // 新增計畫
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

  // 刪除目前計畫
  const btnDelete = document.getElementById("btnDeleteAccount");
  if (btnDelete) {
    btnDelete.onclick = () => window.deleteAccount(appState.activeId);
  }

  // 匯出 Excel
  const btnExport = document.getElementById("btnExport");
  if (btnExport) {
    btnExport.onclick = () => {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      exportExcel(acc);
    };
  }

  // 匯入 Excel
  const inputImport = document.getElementById("inputImport");
  if (inputImport) {
    inputImport.onchange = (e) => {
      importExcel(e, (newAcc) => {
        appState.accounts.push(newAcc);
        window.switchAccount(newAcc.id);
      });
    };
  }

  // 照片辨識與標的自動合併
  const inputCamera = document.getElementById("inputCamera");
  if (inputCamera) {
    inputCamera.onchange = (e) => {
      importFromImage(e, (newAssets) => {
        const acc = appState.accounts.find((a) => a.id === appState.activeId);

        // 遍歷 AI 辨識到的標的 (已在 utils.js 完成合併相加)
        newAssets.forEach((asset) => {
          const existing = acc.assets.find((a) => a.name === asset.name);
          if (existing) {
            // 如果代號已存在，更新股數即可
            existing.shares = asset.shares;
          } else {
            // 不存在則新增
            acc.assets.push(asset);
          }
        });

        saveToStorage();
        refreshAll();
        // 辨識完成後，自動執行一次全域同步更新報價
        syncAllPrices(appState);
      });
    };
  }

  // 全域更新報價按鈕
  document.getElementById("btnSyncAll").onclick = () => syncAllPrices(appState);

  // 手動新增標的
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
    });
    refreshAll();
  };
}

// 啟動程式
init();
