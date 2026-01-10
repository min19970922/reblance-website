/**
 * ui.js
 * 職責：負責所有畫面的更新、HTML 字串生成、動畫觸發與使用者互動反饋
 */
import {
  safeNum,
  calculateAccountData,
  getRebalanceSuggestion,
} from "./state.js";

// 1. 基礎 UI 狀態管理
export function toggleSidebarUI(isCollapsed) {
  const container = document.getElementById("mainContainer");
  const icon = document.getElementById("toggleIcon");
  container.classList.toggle("sidebar-collapsed", isCollapsed);
  icon.className = isCollapsed
    ? "fas fa-bars text-xl"
    : "fas fa-chevron-left text-xl";
}

// 2. 側邊欄計畫列表渲染
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

// 3. 核心表格渲染邏輯
export function renderMainUI(acc) {
  if (!acc) return;

  // 更新基本欄位值
  document.getElementById(
    "activeAccountTitle"
  ).innerHTML = `${acc.name} <i class="fas fa-pen text-2xl text-rose-300 ml-4"></i>`;
  document.getElementById("debtInput").value = acc.totalDebt;
  document.getElementById("cashInput").value = acc.currentCash;
  document.getElementById("usdRateInput").value = acc.usdRate;
  document.getElementById("rebalanceAbsInput").value = acc.rebalanceAbs;
  document.getElementById("rebalanceRelInput").value = acc.rebalanceRel;

  const body = document.getElementById("assetBody");
  body.innerHTML = "";

  // 取得 state.js 的運算結果
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

    // 此時傳入的 asset 物件已經包含 nominalValue 和 priceTwd
    updateAssetRowData(asset, acc, data.netValue);
  });

  updateDashboardUI(data, acc);
}
// 4. 輔助：生成資產列 HTML
function generateAssetRowHTML(asset, index, totalAssets) {
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
                    <span class="text-sm font-black text-rose-600 mt-1 px-1">${
                      asset.fullName || "---"
                    }</span>
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

// 5. 輔助：局部更新資產數據 (不重新繪製整列)
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

  if (!sugg.isTriggered) {
    const color =
      sugg.triggerProgress > 80
        ? "#f43f5e"
        : sugg.triggerProgress > 50
        ? "#fb923c"
        : "#fb7185";
    suggCell.innerHTML = `
            <div class="flex flex-col items-center justify-center w-full px-4">
                <div class="flex justify-between w-full text-[10px] font-black uppercase text-rose-400 tracking-widest"><span>OK</span><span>${Math.round(
                  sugg.triggerProgress
                )}%</span></div>
                <div class="deviation-bar-bg"><div class="deviation-bar-fill" style="width: ${
                  sugg.triggerProgress
                }%; background-color: ${color}"></div></div>
            </div>`;
  } else {
    const isBuy = sugg.diffNominal > 0;
    suggCell.innerHTML = `
            <div class="flex flex-col items-center">
                <div class="flex items-center gap-3">
                    <span class="${
                      isBuy ? "text-emerald-500" : "text-rose-700"
                    } text-rebalance-big tracking-tighter">${
      isBuy ? "加碼" : "減持"
    } $${Math.abs(Math.round(sugg.diffNominal)).toLocaleString()}</span>
                    <span class="text-rose-900 text-rebalance-big border-l-2 border-rose-100 pl-3 tracking-tighter">${Math.abs(
                      sugg.diffShares
                    ).toLocaleString()} 股</span>
                </div>
                <div class="text-[10px] font-black text-rose-400 uppercase tracking-widest mt-1">Cash Impact: $${Math.abs(
                  Math.round(sugg.diffCashImpact)
                ).toLocaleString()}</div>
            </div>`;
  }
}

// 6. 看板數據更新
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
  document
    .getElementById("levBadge")
    .classList.toggle("hidden", data.targetTotalCombined <= 100.1);

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

// 7. Toast 提示動畫
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
