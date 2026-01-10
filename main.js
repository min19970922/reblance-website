/**
 * main.js - 核心邏輯補完版
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
import { exportExcel, importExcel, importFromImage } from "./utils.js"; // 移除了不存在的 parsePastedText

function init() {
  loadFromStorage();

  // 修正點：將 UI 函式掛載至 window，解決循環引用問題
  window.renderMainUI = renderMainUI;
  window.showToast = showToast;

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
  if (!activeAcc) return;

  renderAccountList(appState, "switchAccount", "deleteAccount");
  renderMainUI(activeAcc);

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

// --- 新增：全域函式掛載區 (修正輸入無效問題) ---

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

window.updateGlobal = (key, val) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  if (acc) {
    acc[key] = safeNum(val);
    saveToStorage();
    refreshAll(); // 參數改變後重新計算 UI
  }
};

window.updateAsset = (id, key, val) => {
  const acc = appState.accounts.find((a) => a.id === appState.activeId);
  const asset = acc.assets.find((as) => as.id === id);
  if (asset) {
    asset[key] = key === "name" ? val.toUpperCase() : safeNum(val);
    saveToStorage();
    // 如果是改代號，自動同步一次價格
    if (key === "name" && val.length >= 4) {
      window.fetchLivePrice(id, val);
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

// --- 事件綁定 ---
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
          if (existing) existing.shares = asset.shares;
          else acc.assets.push(asset);
        });
        saveToStorage();
        refreshAll();
        syncAllPrices(appState);
      });
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
    });
    refreshAll();
  };
}

init();
