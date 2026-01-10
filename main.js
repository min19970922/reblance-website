/**
 * main.js
 * 職責：整合所有模組、初始化應用程式、綁定事件監聽器
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
import { exportExcel, importExcel } from "./utils.js";

// --- 1. 初始化應用程式 ---
function init() {
  loadFromStorage();

  // 確保有預選帳戶
  if (
    !appState.activeId ||
    !appState.accounts.find((a) => a.id === appState.activeId)
  ) {
    appState.activeId = appState.accounts[0].id;
  }

  // 恢復側邊欄狀態
  if (appState.isSidebarCollapsed) {
    toggleSidebarUI(true);
  }

  refreshAll();
  bindGlobalEvents();
}

// --- 2. 核心刷新函式 ---
function refreshAll() {
  const activeAcc = appState.accounts.find((a) => a.id === appState.activeId);
  renderAccountList(appState, "switchAccount", "deleteAccount");
  renderMainUI(activeAcc);
}

// --- 3. 綁定事件監聽器 (取代 HTML 中的 onclick) ---
function bindGlobalEvents() {
  // 側邊欄切換
  document.getElementById("btnToggleSidebar").onclick = () => {
    appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
    toggleSidebarUI(appState.isSidebarCollapsed);
    saveToStorage();
  };

  // 新增計畫
  document.getElementById("btnCreateAccount").onclick = () => {
    const name = prompt("計畫名稱:", "新實戰計畫");
    if (!name) return;
    const newAcc = initialAccountTemplate(name);
    appState.accounts.push(newAcc);
    window.switchAccount(newAcc.id);
  };

  // 刪除當前計畫
  document.getElementById("btnDeleteAccount").onclick = () => {
    window.deleteAccount(appState.activeId);
  };

  // 匯出 Excel
  document.getElementById("btnExport").onclick = () => {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    exportExcel(acc);
  };

  // 匯入 Excel
  document.getElementById("inputImport").onchange = (e) => {
    importExcel(e, (newAcc) => {
      appState.accounts.push(newAcc);
      window.switchAccount(newAcc.id);
    });
  };

  // 同步所有報價
  document.getElementById("btnSyncAll").onclick = () => {
    syncAllPrices(appState);
  };

  // 新增資產
  document.getElementById("btnAddAsset").onclick = () => {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    acc.assets.push({
      id: Date.now(),
      name: "",
      fullName: "",
      price: 0,
      shares: 0,
      targetRatio: 0,
      leverage: 1,
    });
    refreshAll();
  };
}

// --- 4. 為了配合 ui.js 生成的動態 HTML，將部分函式掛載至 window ---

window.switchAccount = (id) => {
  appState.activeId = id;
  saveToStorage();
  refreshAll();
};

window.deleteAccount = (id) => {
  if (appState.accounts.length <= 1) return showToast("不可刪除最後一個帳戶");
  if (confirm("確定刪除此計畫？")) {
    appState.accounts = appState.accounts.filter((a) => a.id !== id);
    if (appState.activeId === id) appState.activeId = appState.accounts[0].id;
    saveToStorage();
    refreshAll();
  }
};

window.updateGlobal = (field, value) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  acc[field] = safeNum(value);
  refreshAll(); // 更新計算並存檔
};

window.updateAsset = (assetId, field, value) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  const asset = acc.assets.find((as) => as.id === assetId);
  asset[field] = field === "name" ? value.toUpperCase() : safeNum(value);
  refreshAll();
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

window.removeAsset = (assetId) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  acc.assets = acc.assets.filter((as) => as.id !== assetId);
  saveToStorage();
  refreshAll();
};

window.fetchLivePrice = (id, symbol) => {
  fetchLivePrice(id, symbol, appState);
};

// 啟動應用
init();
