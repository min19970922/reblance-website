/**
 * ui.js
 * 修正：強化非同步名稱抓取時的顯示狀態與 DOM 結構
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
  icon.className = isCollapsed
    ? "fas fa-bars text-xl"
    : "fas fa-chevron-left text-xl";
}

export function renderAccountList(appState, onSwitch, onDelete) {
  const list = document.getElementById("accountList");
  list.innerHTML = "";
  appState.accounts.forEach((acc) => {
    const isActive = acc.id === appState.activeId;
    const div = document.createElement("div");
    div.className = `group flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all ${
      isActive
        ? "bg-rose-500 text-white shadow-lg scale-105"
        : "bg-white hover:bg-rose-50 text-rose-900 border border-rose-50"
    }`;
    div.innerHTML = `
            <div class="flex items-center gap-3 flex-1 overflow-hidden" onclick="${onSwitch}('${
      acc.id
    }')">
              <i class="fas fa-wallet ${
                isActive ? "text-rose-200" : "text-rose-300"
              } text-xl"></i>
              <span class="font-black text-lg truncate">${acc.name}</span>
            </div>
            <button onclick="event.stopPropagation(); ${onDelete}('${
      acc.id
    }')" class="opacity-0 group-hover:opacity-100 p-1 text-rose-200 hover:text-white transition-all">
              <i class="fas fa-trash-alt text-lg"></i>
            </button>
        `;
    list.appendChild(div);
  });
}

export function renderMainUI(acc) {
  if (!acc) return;
  const titleEl = document.getElementById("activeAccountTitle");
  if (titleEl)
    titleEl.innerHTML = `${acc.name} <i class="fas fa-pen text-2xl text-rose-300 ml-4"></i>`;

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
    row.className = "group";
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
  // 修正：如果 fullName 存在且含中文則顯示，否則顯示載入中
  const hasFullName = asset.fullName && /[\u4e00-\u9fa5]/.test(asset.fullName);
  const displayName = hasFullName ? asset.fullName : "正在載入資訊...";
  const nameColor = hasFullName
    ? "text-rose-600"
    : "text-rose-300 animate-pulse";

  return `
        <td class="col-symbol">
            <div class="flex items-center gap-4">
                <div class="flex flex-col">
                    <button onclick="moveAsset(${
                      asset.id
                    }, -1)" class="move-btn ${
    index === 0 ? "invisible" : ""
  }"><i class="fas fa-caret-up"></i></button>
                    <button onclick="moveAsset(${
                      asset.id
                    }, 1)" class="move-btn ${
    index === totalAssets - 1 ? "invisible" : ""
  }"><i class="fas fa-caret-down"></i></button>
                </div>
                <div class="flex flex-col flex-1">
                    <input type="text" value="${
                      asset.name
                    }" onchange="updateAsset(${
    asset.id
  }, 'name', this.value)" class="underline-input uppercase tracking-tighter text-2xl">
                    <span id="nameLabel-${
                      asset.id
                    }" class="text-sm font-black ${nameColor} mt-1 px-1">${displayName}</span>
                </div>
            </div>
        </td>
        <td class="col-leverage">
            <input type="number" value="${
              asset.leverage
            }" onchange="updateAsset(${
    asset.id
  }, 'leverage', this.value)" class="underline-input text-center text-rose-600 font-black text-2xl" step="0.1">
        </td>
        <td class="col-price">
            <div class="flex items-center gap-2">
                <input type="number" value="${
                  asset.price
                }" onchange="updateAsset(${
    asset.id
  }, 'price', this.value)" class="underline-input font-mono-data font-bold text-2xl overflow-visible">
                <button onclick="fetchLivePrice(${asset.id}, '${
    asset.name
  }')" class="text-rose-300 hover:text-rose-500 p-1">
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
  }, 'shares', this.value)" class="underline-input font-mono-data font-bold text-2xl">
        </td>
        <td id="curVal-${
          asset.id
        }" class="col-nominal font-mono-data text-rose-950 font-black text-2xl tracking-tighter">$0</td>
        <td id="curPct-${
          asset.id
        }" class="col-ratio font-mono-data text-indigo-800 font-black text-2xl text-center">0.0%</td>
        <td class="col-ratio text-center">
            <input type="number" value="${
              asset.targetRatio
            }" onchange="updateAsset(${
    asset.id
  }, 'targetRatio', this.value)" class="underline-input text-center text-rose-900 font-black text-2xl inline-block w-16" step="0.1">%
        </td>
        <td id="targetVal-${asset.id}" class="col-target text-center"></td>
        <td id="sugg-${asset.id}" class="col-suggest text-center"></td>
        <td class="text-right">
            <button onclick="removeAsset(${
              asset.id
            })" class="p-2 text-rose-100 hover:text-rose-500 transition-all"><i class="fas fa-trash-alt text-2xl"></i></button>
        </td>
    `;
}

function updateAssetRowData(asset, acc, netValue) {
  if (netValue <= 0) return;
  const sugg = getRebalanceSuggestion(asset, acc, netValue);
  const suggCell = document.getElementById(`sugg-${asset.id}`);
  document.getElementById(`curVal-${asset.id}`).innerText = `$${Math.round(
    asset.nominalValue
  ).toLocaleString()}`;
  document.getElementById(
    `curPct-${asset.id}`
  ).innerText = `${sugg.currentPct.toFixed(1)}%`;
  document.getElementById(`targetVal-${asset.id}`).innerHTML = `
        <div class="flex flex-col text-sm font-black items-center">
            <span class="text-rose-950 font-mono-data text-xl tracking-tighter">$${Math.round(
              sugg.targetNominal
            ).toLocaleString()}</span>
            <span class="text-rose-400 uppercase tracking-widest mt-1 text-[10px]">預算: $${Math.round(
              sugg.targetBookValue
            ).toLocaleString()}</span>
        </div>`;
  const isBuy = sugg.diffNominal > 0;
  suggCell.innerHTML = `
    <div class="flex flex-col items-center">
        <div class="flex items-center gap-3">
            <span class="${
              isBuy ? "text-emerald-500" : "text-rose-700"
            } text-rebalance-big font-bold tracking-tighter">
              ${isBuy ? "加碼" : "減持"} $${Math.abs(
    Math.round(sugg.diffNominal)
  ).toLocaleString()}
            </span>
            <span class="text-rose-900 text-rebalance-big border-l-2 border-rose-100 pl-3 tracking-tighter font-bold">
              ${Math.abs(sugg.diffShares).toLocaleString()} 股
            </span>
        </div>
        <div class="text-[10px] font-black text-rose-400 uppercase tracking-widest mt-1">
          偏差: ${sugg.absDiff.toFixed(1)}% / 門檻: ${acc.rebalanceAbs}%
        </div>
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
  const levBadge = document.getElementById("levBadge");
  if (levBadge)
    levBadge.classList.toggle("hidden", data.targetTotalCombined <= 100.1);
  const mRatioEl = document.getElementById("maintenanceRatio");
  const mCard = document.getElementById("maintenanceCard");
  if (data.maintenanceRatio) {
    mRatioEl.innerText = `${Math.round(data.maintenanceRatio)}%`;
    mCard.className = `glass-card p-6 border-t-8 ${
      data.maintenanceRatio < 140
        ? "border-t-rose-600 bg-rose-50 alert-pulse"
        : data.maintenanceRatio < 166
        ? "border-t-amber-500 bg-amber-50"
        : "border-t-indigo-600"
    }`;
  } else {
    mRatioEl.innerText = "N/A";
    mCard.className = "glass-card p-6 border-t-8 border-t-gray-300 opacity-60";
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
