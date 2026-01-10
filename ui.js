/**
 * ui.js - 專家版 (解決標題載入中、數字切斷與條件建議)
 */
import {
  safeNum,
  calculateAccountData,
  getRebalanceSuggestion,
} from "./state.js";

export function toggleSidebarUI(isCollapsed) {
  const container = document.getElementById("mainContainer");
  const icon = document.getElementById("toggleIcon");
  container.classList.toggle("sidebar-collapsed", isCollapsed);
  icon.className = isCollapsed ? "fas fa-bars" : "fas fa-chevron-left";
}

export function renderAccountList(appState, onSwitch, onDelete) {
  const list = document.getElementById("accountList");
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

  // --- 修復點：確保標題名稱被正確寫入 ---
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

function generateAssetRowHTML(asset, index, totalAssets) {
  const hasContent =
    asset.fullName && asset.fullName !== "" && asset.fullName !== "---";
  const displayName = hasContent ? asset.fullName : "正在載入...";
  const nameColor = hasContent
    ? /[\u4e00-\u9fa5]/.test(asset.fullName)
      ? "text-rose-600"
      : "text-rose-400"
    : "text-rose-300 animate-pulse";

  // --- 修正點：移除所有固定寬度限制，讓表格自然延展 ---
  return `
    <td>
      <div class="flex items-center gap-4">
        <div class="flex flex-col">
          <button onclick="moveAsset(${asset.id},-1)" class="${
    index === 0 ? "invisible" : ""
  }"><i class="fas fa-caret-up"></i></button>
          <button onclick="moveAsset(${asset.id},1)" class="${
    index === totalAssets - 1 ? "invisible" : ""
  }"><i class="fas fa-caret-down"></i></button>
        </div>
        <div class="flex flex-col min-w-[240px]">
          <input type="text" value="${asset.name}" onchange="updateAsset(${
    asset.id
  },'name',this.value)" class="underline-input uppercase font-black">
          <span id="nameLabel-${
            asset.id
          }" class="text-xl font-black ${nameColor} mt-1">${displayName}</span>
        </div>
      </div>
    </td>
    <td class="text-center"><input type="number" value="${
      asset.leverage
    }" onchange="updateAsset(${
    asset.id
  },'leverage',this.value)" class="underline-input text-center text-rose-600 w-24"></td>
    <td>
      <div class="flex items-center gap-2">
        <input type="number" value="${asset.price}" onchange="updateAsset(${
    asset.id
  },'price',this.value)" class="underline-input font-mono-data text-right">
        <button onclick="fetchLivePrice(${asset.id},'${asset.name}')">
          <i id="assetSync-${
            asset.id
          }" class="fas fa-sync-alt text-rose-200"></i>
        </button>
      </div>
    </td>
    <td>
      <input type="number" value="${asset.shares}" onchange="updateAsset(${
    asset.id
  },'shares',this.value)" class="underline-input font-mono-data text-right">
    </td>
    <td id="curVal-${
      asset.id
    }" class="font-mono-data text-rose-950 font-black"></td>
    <td id="curPct-${
      asset.id
    }" class="font-mono-data text-indigo-800 text-center font-black"></td>
    <td class="text-center">
      <input type="number" value="${asset.targetRatio}" onchange="updateAsset(${
    asset.id
  },'targetRatio',this.value)" class="underline-input text-center text-rose-900 w-24 font-black">%
    </td>
    <td id="targetVal-${asset.id}" class="text-center"></td>
    <td id="sugg-${asset.id}" class="text-center"></td>
    <td class="text-right">
      <button onclick="removeAsset(${
        asset.id
      })" class="text-rose-100 hover:text-rose-600">
        <i class="fas fa-trash-alt text-2xl"></i>
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
      <span class="text-2xl text-rose-950 font-mono-data">$${Math.round(
        s.targetNominal
      ).toLocaleString()}</span>
      <span class="text-lg text-rose-400">預算: $${Math.round(
        s.targetBookValue
      ).toLocaleString()}</span>
    </div>`;

  let barColor = "bg-emerald-500";
  if (s.saturation > 0.4) barColor = "bg-lime-500";
  if (s.saturation > 0.6) barColor = "bg-yellow-500";
  if (s.saturation > 0.8) barColor = "bg-orange-500 pulsate-bar";
  if (s.saturation >= 1) barColor = "bg-rose-600 pulsate-bar";

  const isBuy = s.diffNominal > 0;
  const suggCell = document.getElementById(`sugg-${asset.id}`);

  // --- 修正點：未達門檻僅顯示進度條，已觸發才顯示具體文字 ---
  if (!s.isTriggered) {
    suggCell.innerHTML = `
      <div class="flex flex-col items-center min-w-[320px]">
        <div class="w-full h-4 bg-gray-100 rounded-full mt-2 overflow-hidden border">
          <div class="h-full ${barColor} transition-all duration-700" style="width: ${Math.round(
      s.saturation * 100
    )}%"></div>
        </div>
        <div class="flex justify-between w-full text-sm font-black mt-2 text-rose-300">
          <span>偏差: ${s.absDiff.toFixed(1)}%</span>
          <span>達標進度: ${Math.round(s.saturation * 100)}%</span>
        </div>
      </div>`;
  } else {
    suggCell.innerHTML = `
      <div class="flex flex-col items-center min-w-[320px] scale-105 transition-transform">
        <div class="flex items-center gap-4">
          <span class="${
            isBuy ? "text-emerald-500" : "text-rose-700"
          } font-black text-2xl">
            ${isBuy ? "加碼" : "減持"} $${Math.abs(
      Math.round(s.diffNominal)
    ).toLocaleString()}
          </span>
          <span class="text-rose-900 font-black text-2xl border-l-2 pl-4">${Math.abs(
            s.diffShares
          ).toLocaleString()} 股</span>
        </div>
        <div class="w-full h-4 bg-gray-100 rounded-full mt-2 overflow-hidden border">
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
  document.getElementById("toastMsg").innerText = msg;
  t.style.opacity = "1";
  t.style.transform = "translateY(-10px)";
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(0)";
  }, 2500);
}
