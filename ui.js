/**
 * ui.js - 美學專家優化版
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
        : "bg-white hover:bg-rose-50 text-rose-900 border"
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
            </button>
        `;
    list.appendChild(div);
  });
}

export function renderMainUI(acc) {
  if (!acc) return;
  // 更新標題
  const titleEl = document.getElementById("activeAccountTitle");
  if (titleEl)
    titleEl.innerHTML = `${acc.name} <i class="fas fa-pen text-2xl text-rose-200 ml-4"></i>`;

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
  const displayName = hasContent ? asset.fullName : "正在載入資訊...";
  const nameColor = hasContent
    ? /[\u4e00-\u9fa5]/.test(asset.fullName)
      ? "text-rose-600"
      : "text-rose-400"
    : "text-rose-300 animate-pulse";

  return `
        <td class="col-symbol">
            <div class="flex items-center gap-4">
                <div class="flex flex-col gap-1">
                    <button onclick="moveAsset(${asset.id}, -1)" class="${
    index === 0 ? "invisible" : ""
  }"><i class="fas fa-caret-up"></i></button>
                    <button onclick="moveAsset(${asset.id}, 1)" class="${
    index === totalAssets - 1 ? "invisible" : ""
  }"><i class="fas fa-caret-down"></i></button>
                </div>
                <div class="flex flex-col">
                    <input type="text" value="${
                      asset.name
                    }" onchange="updateAsset(${
    asset.id
  }, 'name', this.value)" class="underline-input uppercase tracking-tighter w-40">
                    <span id="nameLabel-${
                      asset.id
                    }" class="text-xl font-black ${nameColor} mt-1">${displayName}</span>
                </div>
            </div>
        </td>
        <td class="col-leverage text-center">
            <input type="number" value="${
              asset.leverage
            }" onchange="updateAsset(${
    asset.id
  }, 'leverage', this.value)" class="underline-input text-center text-rose-600 w-20" step="0.1">
        </td>
        <td class="col-price">
            <div class="flex items-center gap-2">
                <input type="number" value="${
                  asset.price
                }" onchange="updateAsset(${
    asset.id
  }, 'price', this.value)" class="underline-input font-mono-data w-44">
                <button onclick="fetchLivePrice(${asset.id}, '${
    asset.name
  }')" class="text-rose-200 hover:text-rose-500">
                    <i id="assetSync-${
                      asset.id
                    }" class="fas fa-sync-alt text-xl"></i>
                </button>
            </div>
        </td>
        <td class="col-shares">
            <input type="number" value="${
              asset.shares
            }" onchange="updateAsset(${
    asset.id
  }, 'shares', this.value)" class="underline-input font-mono-data w-44">
        </td>
        <td id="curVal-${
          asset.id
        }" class="col-nominal font-mono-data text-rose-950 font-black tracking-tighter"></td>
        <td id="curPct-${
          asset.id
        }" class="col-ratio font-mono-data text-indigo-800 text-center font-black"></td>
        <td class="col-ratio text-center">
            <input type="number" value="${
              asset.targetRatio
            }" onchange="updateAsset(${
    asset.id
  }, 'targetRatio', this.value)" class="underline-input text-center text-rose-900 w-20" step="0.1">%
        </td>
        <td id="targetVal-${asset.id}" class="col-target text-center"></td>
        <td id="sugg-${asset.id}" class="col-suggest text-center"></td>
        <td class="text-right">
            <button onclick="removeAsset(${
              asset.id
            })" class="p-2 text-rose-100 hover:text-rose-600"><i class="fas fa-trash-alt text-2xl"></i></button>
        </td>
    `;
}

function updateAssetRowData(asset, acc, netValue) {
  if (netValue <= 0) return;
  const sugg = getRebalanceSuggestion(asset, acc, netValue);
  document.getElementById(`curVal-${asset.id}`).innerText = `$${Math.round(
    asset.nominalValue
  ).toLocaleString()}`;
  document.getElementById(
    `curPct-${asset.id}`
  ).innerText = `${sugg.currentPct.toFixed(1)}%`;
  document.getElementById(`targetVal-${asset.id}`).innerHTML = `
        <div class="flex flex-col font-black items-center">
            <span class="text-rose-950 font-mono-data text-2xl">$${Math.round(
              sugg.targetNominal
            ).toLocaleString()}</span>
            <span class="text-rose-400 text-lg">預算: $${Math.round(
              sugg.targetBookValue
            ).toLocaleString()}</span>
        </div>`;

  const isBuy = sugg.diffNominal > 0;
  document.getElementById(`sugg-${asset.id}`).innerHTML = `
    <div class="flex flex-col items-center">
        <div class="flex items-center gap-4">
            <span class="${
              isBuy ? "text-emerald-500" : "text-rose-700"
            } font-black text-2xl">
              ${isBuy ? "加碼" : "減持"} $${Math.abs(
    Math.round(sugg.diffNominal)
  ).toLocaleString()}
            </span>
            <span class="text-rose-900 font-black text-2xl border-l-2 border-rose-100 pl-4">
              ${Math.abs(sugg.diffShares).toLocaleString()} 股
            </span>
        </div>
        <div class="text-lg font-black text-rose-300">偏差: ${sugg.absDiff.toFixed(
          1
        )}%</div>
    </div>`;
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
