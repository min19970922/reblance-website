/**
 * ui.js - 專家對齊適配版 (v3.6)
 * 實現代碼：自動寬度鏡像同步，整欄對齊最寬數值
 */
import {
  safeNum,
  calculateAccountData,
  getRebalanceSuggestion,
} from "./state.js";

import { fetchLivePrice } from "./api.js";

export function toggleSidebarUI(isCollapsed) {
  const container = document.getElementById("mainContainer");
  const icon = document.getElementById("toggleIcon");
  container.classList.toggle("sidebar-collapsed", isCollapsed);
  icon.className = isCollapsed ? "fas fa-bars" : "fas fa-chevron-left";
}

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
    }')" class="opacity-0 group-hover:opacity-100 p-1 text-rose-200 hover:text-white">
        <i class="fas fa-trash-alt text-lg"></i>
      </button>`;
    list.appendChild(div);
  });
}

export function renderMainUI(acc) {
  if (!acc) return;
  const titleEl = document.getElementById("activeAccountTitle");
  if (titleEl)
    titleEl.innerHTML = `${acc.name} <i class="fas fa-pen text-xl text-rose-200 ml-4"></i>`;

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

/**
 * 自動對齊組件：生成疊加的隱形鏡像層與輸入框
 */
const autoWidthInput = (
  assetId,
  field,
  value,
  extraClass = "",
  type = "text"
) => `
  <div class="input-col-wrapper">
    <span class="input-mirror ${extraClass}">${value}</span>
    <input type="${type}" 
      value="${value}" 
      oninput="this.previousElementSibling.innerText = this.value"
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
      <div class="flex items-center gap-2">
        <div class="flex flex-col text-[10px] text-rose-200">
          <button onclick="moveAsset(${asset.id},-1)" class="${
    index === 0 ? "invisible" : ""
  }"><i class="fas fa-caret-up"></i></button>
          <button onclick="moveAsset(${asset.id},1)" class="${
    index === totalAssets - 1 ? "invisible" : ""
  }"><i class="fas fa-caret-down"></i></button>
        </div>
        <div class="flex flex-col">
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
    <td class="text-center">
      ${autoWidthInput(
        asset.id,
        "leverage",
        asset.leverage,
        "text-rose-600 font-black text-center text-xl",
        "number"
      )}
    </td>
    <td class="text-right">
      <div class="flex items-center justify-end gap-1">
        ${autoWidthInput(
          asset.id,
          "price",
          asset.price,
          "font-mono-data text-right text-xl",
          "number"
        )}
        <button onclick="fetchLivePrice(${asset.id},'${asset.name}')">
          <i id="assetSync-${
            asset.id
          }" class="fas fa-sync-alt text-rose-100 hover:text-rose-400"></i>
        </button>
      </div>
    </td>
    <td class="text-right">
      ${autoWidthInput(
        asset.id,
        "shares",
        asset.shares,
        "font-mono-data text-right text-xl",
        "number"
      )}
    </td>
    <td id="curVal-${
      asset.id
    }" class="font-mono-data text-rose-950 font-black text-right px-4 text-xl"></td>
    <td id="curPct-${
      asset.id
    }" class="font-mono-data text-indigo-800 text-center font-black px-4 text-xl"></td>
    <td class="text-center">
      <div class="flex items-center justify-center gap-1">
        ${autoWidthInput(
          asset.id,
          "targetRatio",
          asset.targetRatio,
          "text-center text-rose-900 font-black text-xl",
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
      })" class="text-rose-100 hover:text-rose-600">
        <i class="fas fa-trash-alt text-xl"></i>
      </button>
    </td>`;
}

function updateAssetRowData(asset, acc, netValue) {
  if (netValue <= 0) return;
  const s = getRebalanceSuggestion(asset, acc, netValue);
  document.getElementById(`curVal-${asset.id}`).innerText = `$${Math.round(
    asset.nominalValue
  ).toLocaleString()}`;
  document.getElementById(
    `curPct-${asset.id}`
  ).innerText = `${s.currentPct.toFixed(1)}%`;

  document.getElementById(`targetVal-${asset.id}`).innerHTML = `
    <div class="flex flex-col font-black">
      <span class="text-xl text-rose-950 font-mono-data">$${Math.round(
        s.targetNominal
      ).toLocaleString()}</span>
      <span class="text-xs text-rose-300">預算: $${Math.round(
        s.targetBookValue
      ).toLocaleString()}</span>
    </div>`;

  let barColor = "bg-emerald-500";
  if (s.saturation > 0.8) barColor = "bg-orange-500 pulsate-bar";
  if (s.saturation >= 1) barColor = "bg-rose-600 pulsate-bar";

  const isBuy = s.diffNominal > 0;
  const suggCell = document.getElementById(`sugg-${asset.id}`);

  if (!s.isTriggered) {
    suggCell.innerHTML = `
      <div class="flex flex-col items-center min-w-[150px]">
        <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden border">
          <div class="h-full ${barColor} transition-all duration-700" style="width: ${Math.round(
      s.saturation * 100
    )}%"></div>
        </div>
        <span class="text-[10px] font-black text-rose-200 mt-1">偏差: ${s.absDiff.toFixed(
          1
        )}%</span>
      </div>`;
  } else {
    suggCell.innerHTML = `
      <div class="flex flex-col items-center min-w-[150px] scale-105">
        <div class="flex items-baseline gap-2">
          <span class="${
            isBuy ? "text-emerald-500" : "text-rose-700"
          } font-black text-lg">${isBuy ? "加碼" : "減持"}</span>
          <span class="text-rose-950 font-black text-lg">${Math.abs(
            s.diffShares
          ).toLocaleString()} 股</span>
        </div>
        <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden border mt-1">
           <div class="h-full ${barColor} shadow-inner" style="width: 100%"></div>
        </div>
      </div>`;
  }
}

function updateDashboardUI(data, acc) {
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
  if (data.maintenanceRatio)
    mRatioEl.innerText = `${Math.round(data.maintenanceRatio)}%`;
}

export function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  document.getElementById("toastMsg").innerText = msg;
  t.style.opacity = "1";
  t.style.transform = "translateY(-10px)";
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(0)";
  }, 2500);
}
