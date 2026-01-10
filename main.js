/**
 * main.js - 終極整合修復版
 * 1. 修復了所有 window 全域函式掛載
 * 2. 整合了照片辨識與文字貼上雙模組
 * 3. 解決了因 HTML 元素不存在導致的 null 報錯
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
  parsePastedText,
  importFromImage,
} from "./utils.js";

function init() {
  loadFromStorage();

  // 確保至少有一個帳戶
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
 * 統一更新入口
 */
function refreshAll() {
  const activeAcc = appState.accounts.find((a) => a.id === appState.activeId);
  if (!activeAcc) return;

  renderAccountList(appState, "switchAccount", "deleteAccount");
  renderMainUI(activeAcc);

  // 計畫名稱點擊重新命名功能
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

function bindGlobalEvents() {
  // 1. 側邊欄切換
  const btnToggle = document.getElementById("btnToggleSidebar");
  if (btnToggle) {
    btnToggle.onclick = () => {
      appState.isSidebarCollapsed = !appState.isSidebarCollapsed;
      toggleSidebarUI(appState.isSidebarCollapsed);
      saveToStorage();
    };
  }

  // 2. 新增計畫
  const btnCreate = document.getElementById("btnCreateAccount");
  if (btnCreate) {
    btnCreate.onclick = () => {
      const name = prompt("計畫名稱:", "新實戰計畫");
      if (!name) return;
      const newAcc = initialAccountTemplate(name);
      appState.accounts.push(newAcc);
      window.switchAccount(newAcc.id);
    };
  }

  // 3. 刪除計畫
  const btnDelete = document.getElementById("btnDeleteAccount");
  if (btnDelete) {
    btnDelete.onclick = () => window.deleteAccount(appState.activeId);
  }

  // 4. 匯出 Excel
  const btnExport = document.getElementById("btnExport");
  if (btnExport) {
    btnExport.onclick = () => {
      const acc = appState.accounts.find((a) => a.id === appState.activeId);
      exportExcel(acc);
    };
  }

  // 5. 匯入 Excel
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

  // 移除原有的 btnShowPaste 與 btnConfirmPaste 邏輯

  // 8. 報價同步與新增標的
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

// 執行初始化
init();
