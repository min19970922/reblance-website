/**
 * ui.js - 策略增強鎖定版 (v6.0)
 * 1. 移除表格內現金列，與頂部參數區同步
 * 2. 增加資產鎖定按鈕圖標
 * 3. 優化 6x6 佈局看板數據顯示
 */
import {
  safeNum,
  calculateAccountData,
  getRebalanceSuggestion,
} from "./state.js";

import { fetchLivePrice } from "./api.js";

/**
 * 側邊欄切換
 */
export function toggleSidebarUI(isCollapsed) {
  const container = document.getElementById("mainContainer");
  const icon = document.getElementById("toggleIcon");
  const aside = document.querySelector("aside");

  container.classList.toggle("sidebar-collapsed", isCollapsed);
  icon.className = isCollapsed ? "fas fa-bars" : "fas fa-chevron-left";

  if (aside) {
    aside.style.visibility = isCollapsed ? "hidden" : "visible";
    aside.style.opacity = isCollapsed ? "0" : "1";
  }
}

/**
 * 渲染帳戶列表
 */
export function renderAccountList(appState, onSwitch, onDelete) {
  const list = document.getElementById("accountList");
  if (!list) return;
  list.innerHTML = "";
  appState.accounts.forEach((acc) => {
    const isActive = acc.id === appState.activeId;
    const div = document.createElement("div");
    div.className = `group flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all ${isActive
      ? "bg-rose-500 text-white shadow-lg"
      : "bg-white hover:bg-rose-50 border"
      }`;
    div.innerHTML = `
      <div class="flex items-center gap-3 flex-1" onclick="${onSwitch}('${acc.id
      }')">
        <i class="fas fa-wallet ${isActive ? "text-rose-200" : "text-rose-300"
      } text-xl"></i>
        <span class="font-black text-xl">${acc.name}</span>
      </div>
      <button onclick="event.stopPropagation(); ${onDelete}('${acc.id
      }')" class="opacity-0 group-hover:opacity-100 p-1 text-rose-200 hover:text-white transition-opacity">
        <i class="fas fa-trash-alt text-lg"></i>
      </button>`;
    list.appendChild(div);
  });
}

/**
 * 核心渲染函式
 */
export function renderMainUI(acc) {
  if (!acc) return;

  const titleEl = document.getElementById("activeAccountTitle");
  if (titleEl)
    titleEl.innerHTML = `${acc.name} <i class="fas fa-pen text-xl text-rose-200 ml-4"></i>`;

  // 同步參數區輸入框
  document.getElementById("debtInput").value = acc.totalDebt;
  document.getElementById("cashInput").value = acc.currentCash;
  document.getElementById("cashRatioInput").value = acc.cashRatio || 0;
  document.getElementById("usdRateInput").value = acc.usdRate;
  document.getElementById("rebalanceAbsInput").value = acc.rebalanceAbs;
  document.getElementById("rebalanceRelInput").value = acc.rebalanceRel;

  const body = document.getElementById("assetBody");
  if (!body) return;
  body.innerHTML = "";

  const data = calculateAccountData(acc);

  // 渲染實體資產
  data.assetsCalculated.forEach((asset, index) => {
    const row = document.createElement("tr");
    row.innerHTML = generateAssetRowHTML(
      asset,
      index,
      data.assetsCalculated.length
    );
    body.appendChild(row);
    updateAssetRowData(asset, acc, data.netValue);
  });

  updateDashboardUI(data, acc);
}

/**
 * 自動適應寬度輸入框
 */
const autoWidthInput = (
  assetId,
  field,
  value,
  extraClass = "",
  type = "text"
) => `
  <div class="input-col-wrapper">
    <span class="input-mirror ${extraClass}">${value || "&nbsp;&nbsp;"}</span>
    <input type="${type}" 
      value="${value}" 
      oninput="this.previousElementSibling.innerText = this.value || '&nbsp;&nbsp;'"
      onchange="updateAsset(${assetId},'${field}',this.value)" 
      class="underline-input ${extraClass}">
  </div>
`;

/**
 * 產生一般資產列 HTML (含鎖定按鈕)
 */
function generateAssetRowHTML(asset, index, totalAssets) {
  const hasContent =
    asset.fullName && asset.fullName !== "" && asset.fullName !== "---";
  const displayName = hasContent ? asset.fullName : "正在載入...";
  const isLocked = asset.isLocked || false;

  return `
    <td class="px-2">
      <div class="flex items-center justify-start gap-3">
        <div class="flex flex-col text-[10px] text-rose-200">
          <button onclick="moveAsset(${asset.id},-1)" class="${index === 0 ? "invisible" : ""
    } hover:text-rose-500"><i class="fas fa-caret-up"></i></button>
          <button onclick="moveAsset(${asset.id},1)" class="${index === totalAssets - 1 ? "invisible" : ""
    } hover:text-rose-500"><i class="fas fa-caret-down"></i></button>
        </div>
        <button onclick="toggleLock(${asset.id
    })" class="text-xl transition-colors ${isLocked ? "text-rose-600" : "text-gray-200 hover:text-rose-300"
    }">
          <i class="fas ${isLocked ? "fa-lock" : "fa-lock-open"}"></i>
        </button>
        <div class="flex flex-col items-center flex-1">
          ${autoWidthInput(
      asset.id,
      "name",
      asset.name,
      "uppercase font-black text-2xl"
    )}
          <span id="nameLabel-${asset.id
    }" class="text-sm font-bold text-rose-400 whitespace-nowrap">${displayName}</span>
        </div>
      </div>
    </td>
    <td class="text-center">${autoWidthInput(
      asset.id,
      "leverage",
      asset.leverage,
      "text-rose-600 font-black text-xl",
      "number"
    )}</td>
    <td class="text-center">
      <div class="flex items-center justify-center gap-1">
        ${autoWidthInput(
      asset.id,
      "price",
      asset.price,
      "font-mono-data text-xl",
      "number"
    )}
        <button onclick="fetchLivePrice(${asset.id},'${asset.name}')">
          <i id="assetSync-${asset.id
    }" class="fas fa-sync-alt text-rose-100 hover:text-rose-400"></i>
        </button>
      </div>
    </td>
    <td class="text-center">${autoWidthInput(
      asset.id,
      "shares",
      asset.shares,
      "font-mono-data text-xl",
      "number"
    )}</td>
    <td id="curVal-${asset.id
    }" class="font-mono-data text-rose-950 font-black px-4 text-xl"></td>
    <td id="curPct-${asset.id
    }" class="font-mono-data text-indigo-800 text-center font-black px-4 text-xl"></td>
    <td class="text-center">
      <div class="flex items-center justify-center gap-1">
        ${autoWidthInput(
      asset.id,
      "targetRatio",
      asset.targetRatio,
      "text-rose-900 font-black text-xl",
      "number"
    )}
        <span class="text-rose-900 font-black">%</span>
      </div>
    </td>
    <td id="targetVal-${asset.id}" class="text-center px-4"></td>
    <td id="sugg-${asset.id}" class="text-center px-4"></td>
    <td class="text-right px-2">
      <button onclick="removeAsset(${asset.id
    })" class="text-rose-100 hover:text-rose-600"><i class="fas fa-trash-alt text-xl"></i></button>
    </td>`;
}

export function updateAssetRowData(asset, acc, netValue) {
  if (netValue <= 0) return;
  const s = getRebalanceSuggestion(asset, acc, netValue);

  const curValEl = document.getElementById(`curVal-${asset.id}`);
  if (curValEl) curValEl.innerText = `$${Math.round(asset.nominalValue).toLocaleString()}`;

  const curPctEl = document.getElementById(`curPct-${asset.id}`);
  if (curPctEl) curPctEl.innerText = `${s.currentPct.toFixed(1)}%`;

  const targetValEl = document.getElementById(`targetVal-${asset.id}`);
  if (targetValEl) {
    targetValEl.innerHTML = `
      <div class="flex flex-col font-black">
        <span class="text-rose-950 asset-data-text">$${Math.round(s.targetNominal).toLocaleString()}</span>
        <span class="text-[12px] text-rose-300 uppercase tracking-tighter">預算: $${Math.round(s.targetBookValue).toLocaleString()}</span>
      </div>`;
  }

  const suggCell = document.getElementById(`sugg-${asset.id}`);
  if (suggCell) {
    let barColor = "bg-emerald-400";
    if (s.saturation > 0.5) barColor = "bg-amber-400";
    if (s.saturation > 0.8) barColor = "bg-rose-500";

    const isBuy = s.diffNominal > 0;
    const actionText = s.isTriggered
      ? `${isBuy ? "加碼" : "減持"} $${Math.abs(Math.round(s.diffNominal)).toLocaleString()}`
      : "監控中";

    suggCell.innerHTML = `
      <div class="flex flex-col items-center min-w-[200px] ${s.isTriggered ? "status-triggered" : "status-monitoring"}">
        <div class="flex flex-row items-center gap-2 font-black leading-tight sugg-text-group">
           <span class="${s.isTriggered ? (isBuy ? "text-emerald-500" : "text-rose-700") : "text-gray-400"}">${actionText}</span>
           <span class="text-rose-900 ${s.isTriggered ? "" : "hidden"}">(${Math.abs(s.diffShares).toLocaleString()} 股)</span>
        </div>
        <div class="rebalance-bar-bg"><div class="h-full ${barColor} transition-all duration-700" style="width: ${Math.min(100, s.saturation * 100)}%"></div></div>
      </div>`;
  }
}

export function updateDashboardUI(data, acc) {
  document.getElementById("totalNetValue").innerText = `$${Math.round(
    data.netValue
  ).toLocaleString()}`;
  document.getElementById("totalExposure").innerText = `$${Math.round(
    data.totalNominalExposure
  ).toLocaleString()}`;
  document.getElementById(
    "leverageDisplay"
  ).innerText = `${data.totalLeverage.toFixed(2)}x`;

  const targetEl = document.getElementById("targetTotalRatio");
  if (targetEl) {
    targetEl.innerText = `${data.targetTotalCombined.toFixed(1)}%`;
    targetEl.className =
      Math.abs(data.targetTotalCombined - 100) > 0.1
        ? "font-mono-data text-rose-600"
        : "font-mono-data text-indigo-600";
  }

  const mRatioEl = document.getElementById("maintenanceRatio");
  if (mRatioEl) {
    if (data.maintenanceRatio > 0) {
      mRatioEl.innerText = `${Math.round(data.maintenanceRatio)}%`;
      mRatioEl.className =
        data.maintenanceRatio < 140
          ? "font-mono-data text-rose-600 animate-pulse"
          : "font-mono-data text-indigo-600";
    } else {
      mRatioEl.innerText = "N/A";
    }
  }
}

export function showToast(msg) {
  const t = document.getElementById("toast");
  const msgEl = document.getElementById("toastMsg");
  if (!t || !msgEl) return;
  msgEl.innerText = msg;
  t.style.opacity = "1";
  t.style.transform = "translateY(-10px)";
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(0)";
  }, 2500);
}
