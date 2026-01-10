/**
 * main.js - 修復計畫新增與事件綁定
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
import { exportExcel, importExcel, importFromImage } from "./utils.js"; // 加上 importFromImage

function init() {
  loadFromStorage();
  if (
    !appState.activeId ||
    !appState.accounts.find((a) => a.id === appState.activeId)
  ) {
    appState.activeId = appState.accounts[0].id;
  }
  if (appState.isSidebarCollapsed) toggleSidebarUI(true);
  refreshAll();
  bindGlobalEvents();
}

function refreshAll() {
  const activeAcc = appState.accounts.find((a) => a.id === appState.activeId);
  renderAccountList(appState, "switchAccount", "deleteAccount");
  renderMainUI(activeAcc);
}

function bindGlobalEvents() {
  document.getElementById("btnToggleSidebar").onclick = () => {
    appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
    toggleSidebarUI(appState.isSidebarCollapsed);
    saveToStorage();
  };

  // 修正：新增計畫綁定
  document.getElementById("btnCreateAccount").onclick = () => {
    const name = prompt("計畫名稱:", "新實戰計畫");
    if (!name) return;
    const newAcc = initialAccountTemplate(name);
    appState.accounts.push(newAcc);
    window.switchAccount(newAcc.id);
  };

  document.getElementById("btnDeleteAccount").onclick = () => {
    window.deleteAccount(appState.activeId);
  };

  document.getElementById("btnExport").onclick = () => {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    exportExcel(acc);
  };

  document.getElementById("inputImport").onchange = (e) => {
    importExcel(e, (newAcc) => {
      appState.accounts.push(newAcc);
      window.switchAccount(newAcc.id);
    });
  };

  document.getElementById("inputCamera").onchange = (e) => {
    importFromImage(e, (newAssets) => {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);

      newAssets.forEach((asset) => {
        // 如果代碼已存在，更新股數；不存在則新增
        const existing = acc.assets.find((a) => a.name === asset.name);
        if (existing) {
          existing.shares = asset.shares;
        } else {
          acc.assets.push(asset);
        }
      });

      saveToStorage();
      refreshAll();
      // 辨識完自動抓一次最新價格與名稱
      syncAllPrices(appState);
    });
  };

  document.getElementById("btnSyncAll").onclick = () => {
    syncAllPrices(appState);
  };

  document.getElementById("btnAddAsset").onclick = () => {
    const acc = appState.accounts.find((a) => a.id === appState.activeId);
    acc.assets.push({
      id: Date.now(),
      name: "",
      fullName: "---", // 初始值改為 "---"
      price: 0,
      shares: 0,
      targetRatio: 0,
      leverage: 1,
    });
    refreshAll();
  };
}

// 掛載至 window 供動態 HTML 調用
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
  refreshAll();
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
  fetchLivePrice(id, symbol, appState); // 確保這裡有傳入 appState
};

init();
