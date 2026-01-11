/**
 * ui.js - 策略增強版 (v5.0)
 * 1. 整合 5/25 門檻判定：未達標顯示「監控中」
 * 2. 進度條漸層：綠(0-50%) → 黃(50-80%) → 紅(80%+)
 * 3. 動態動畫：飽和度 > 80% 自動觸發 pulse-soft
 */
import {
  safeNum,
  calculateAccountData,
  getRebalanceSuggestion,
} from "./state.js";

import { fetchLivePrice } from "./api.js";

/**
 * 側邊欄切換：解決縮回時的殘影問題
 */
export function toggleSidebarUI(isCollapsed) {
  const container = document.getElementById("mainContainer");
  const icon = document.getElementById("toggleIcon");
  const aside = document.querySelector("aside");

  container.classList.toggle("sidebar-collapsed", isCollapsed);
  icon.className = isCollapsed ? "fas fa-bars" : "fas fa-chevron-left";

  if (aside) {
    if (isCollapsed) {
      aside.style.visibility = "hidden";
      aside.style.opacity = "0";
    } else {
      aside.style.visibility = "visible";
      aside.style.opacity = "1";
    }
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
    div.className = `group flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all ${
      isActive
        ? "bg-rose-500 text-white shadow-lg"
        : "bg-white hover:bg-rose-50 border"
    }`;
    div.innerHTML = `
      <div class="flex items-center gap-3 flex-1" onclick="${onSwitch}('${
      acc.id
    }')">
        <i class="fas fa-wallet ${
          isActive ? "text-rose-200" : "text-rose-300"
        } text-xl"></i>
        <span class="font-black text-xl">${acc.name}</span>
      </div>
      <button onclick="event.stopPropagation(); ${onDelete}('${
      acc.id
    }')" class="opacity-0 group-hover:opacity-100 p-1 text-rose-200 hover:text-white transition-opacity">
        <i class="fas fa-trash-alt text-lg"></i>
      </button>`;
    list.appendChild(div);
  });
}

/**
 * 渲染主介面
 */
export function renderMainUI(acc) {
  if (!acc) return;
  const titleEl = document.getElementById("activeAccountTitle");
  if (titleEl) {
    titleEl.innerHTML = `${acc.name} <i class="fas fa-pen text-xl text-rose-200 ml-4"></i>`;
  }

  document.getElementById("debtInput").value = acc.totalDebt;
  document.getElementById("cashInput").value = acc.currentCash;
  document.getElementById("usdRateInput").value = acc.usdRate;
  document.getElementById("rebalanceAbsInput").value = acc.rebalanceAbs;
  document.getElementById("rebalanceRelInput").value = acc.rebalanceRel;

  const body = document.getElementById("assetBody");
  if (!body) return;
  body.innerHTML = "";

  const data = calculateAccountData(acc);
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

function generateAssetRowHTML(asset, index, totalAssets) {
  const hasContent =
    asset.fullName && asset.fullName !== "" && asset.fullName !== "---";
  const displayName = hasContent ? asset.fullName : "正在載入...";
  const nameColor = hasContent
    ? /[\u4e00-\u9fa5]/.test(asset.fullName)
      ? "text-rose-600"
      : "text-rose-400"
    : "text-rose-300 animate-pulse";

  return `
    <td class="px-2">
      <div class="flex items-center justify-center gap-2">
        <div class="flex flex-col text-[10px] text-rose-200">
          <button onclick="moveAsset(${asset.id},-1)" class="${
    index === 0 ? "invisible" : ""
  } hover:text-rose-500">
            <i class="fas fa-caret-up"></i>
          </button>
          <button onclick="moveAsset(${asset.id},1)" class="${
    index === totalAssets - 1 ? "invisible" : ""
  } hover:text-rose-500">
            <i class="fas fa-caret-down"></i>
          </button>
        </div>
        <div class="flex flex-col items-center">
          ${autoWidthInput(
            asset.id,
            "name",
            asset.name,
            "uppercase font-black text-2xl"
          )}
          <span id="nameLabel-${
            asset.id
          }" class="text-sm font-bold ${nameColor} whitespace-nowrap">${displayName}</span>
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
        <button onclick="fetchLivePrice(${asset.id},'${
    asset.name
  }')" title="同步報價">
          <i id="assetSync-${
            asset.id
          }" class="fas fa-sync-alt text-rose-100 hover:text-rose-400 transition-colors"></i>
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
    <td id="curVal-${
      asset.id
    }" class="font-mono-data text-rose-950 font-black px-4 text-xl"></td>
    <td id="curPct-${
      asset.id
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
      <button onclick="removeAsset(${
        asset.id
      })" class="text-rose-100 hover:text-rose-600 transition-colors">
        <i class="fas fa-trash-alt text-xl"></i>
      </button>
    </td>`;
}

/**
 * 更新單列數據與建議 (策略增強版)
 */
export function updateAssetRowData(asset, acc, netValue) {
  if (netValue <= 0) return;
  const s = getRebalanceSuggestion(asset, acc, netValue);

  // 1. 更新目前市值與目前佔比
  const curValEl = document.getElementById(`curVal-${asset.id}`);
  if (curValEl)
    curValEl.innerText = `$${Math.round(asset.nominalValue).toLocaleString()}`;

  const curPctEl = document.getElementById(`curPct-${asset.id}`);
  if (curPctEl) curPctEl.innerText = `${s.currentPct.toFixed(1)}%`;

  // 2. 更新目標數值
  const targetValEl = document.getElementById(`targetVal-${asset.id}`);
  if (targetValEl) {
    targetValEl.innerHTML = `
      <div class="flex flex-col font-black">
        <span class="text-xl text-rose-950 font-mono-data">$${Math.round(
          s.targetNominal
        ).toLocaleString()}</span>
        <span class="text-xs text-rose-300">預算: $${Math.round(
          s.targetBookValue
        ).toLocaleString()}</span>
      </div>`;
  }

  // 3. 更新再平衡建議 (重點修改區)
  const suggCell = document.getElementById(`sugg-${asset.id}`);
  if (suggCell) {
    // 漸層顏色邏輯：綠(0-50%) -> 黃(50-80%) -> 紅(80%+)
    let barColor = "bg-emerald-400";
    let animateClass = "";

    if (s.saturation > 0.5) barColor = "bg-amber-400";
    if (s.saturation > 0.8) {
      barColor = "bg-rose-500";
      animateClass = "animate-pulse-soft"; // 觸發 CSS 定義的呼吸燈
    }

    const isBuy = s.diffNominal > 0;

    // 判定顯示文字：未達門檻(isTriggered 為 false)則顯示監控中
    const actionText = s.isTriggered
      ? `${isBuy ? "加碼" : "減持"} $${Math.abs(
          Math.round(s.diffNominal)
        ).toLocaleString()}`
      : "監控中";

    // 狀態類別樣式 (對應 CSS 中的縮放與灰階效果)
    const statusClass = s.isTriggered
      ? "status-triggered"
      : "status-monitoring";

    suggCell.innerHTML = `
      <div class="flex flex-col items-center min-w-[180px] ${statusClass}">
        <div class="flex flex-col items-center">
          <span class="${
            s.isTriggered
              ? isBuy
                ? "text-emerald-500"
                : "text-rose-700"
              : "text-gray-400"
          } font-black text-lg leading-tight">
            ${actionText}
          </span>
          <span class="text-rose-950 font-black text-sm ${
            s.isTriggered ? "" : "hidden"
          }">
            約 ${Math.abs(s.diffShares).toLocaleString()} 股
          </span>
        </div>
        <div class="rebalance-bar-bg ${animateClass}">
           <div class="h-full ${barColor} shadow-inner transition-all duration-700" style="width: ${Math.min(
      100,
      s.saturation * 100
    )}%"></div>
        </div>
        <span class="text-[10px] font-bold text-rose-300 mt-1">偏差: ${s.absDiff.toFixed(
          1
        )}%</span>
      </div>`;
  }
}

/**
 * 更新數據看板
 */
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
  document.getElementById(
    "targetTotalRatio"
  ).innerText = `${data.targetTotalCombined.toFixed(1)}%`;

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

/**
 * 彈出通知系統
 */
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
