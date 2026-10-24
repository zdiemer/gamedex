"use strict";

// UI components for wishlist.js. Feature state and orchestration remain in that module.

// The deal block for a wishlist drawer: the price line, a "View on Steam" chip
// (always, when we know the appid), and a "Buy on <vendor>" chip for the lowest
// current deal (which may be a third-party seller, and may carry a coupon).
function wishlistDealHtml(row) {
  const steamId = row._wlAppIds && row._wlAppIds.steam;
  const p = row._wlPrice;
  if (!steamId && !p) return "";
  const chips = [];
  if (steamId) {
    chips.push(`<a class="btn ghost" href="${escapeHtml(storeUrl("steam", steamId))}"
      target="_blank" rel="noopener">View on Steam ↗</a>`);
  }
  // Buy on the best-deal vendor — only when it's a real, different link (not just
  // the same Steam store we already linked, unless it's discounted there).
  if (p && p.url && p.current != null && (p.shop !== "Steam" || p.cut > 0)) {
    const label = p.shop ? `Buy on ${p.shop}` : "Buy";
    const price = _money(p.current, p.currency);
    chips.push(`<a class="btn buy" href="${escapeHtml(p.url)}" target="_blank" rel="noopener"
      title="${escapeHtml(p.voucher ? "Coupon: " + p.voucher : "")}">${escapeHtml(label)} · ${escapeHtml(price)}${p.cut > 0 ? ` (−${p.cut}%)` : ""} ↗</a>`);
  }
  // In a current bundle — a chip linking straight to it.
  const bnd = row._wlBundle;
  if (bnd && bnd.url) {
    chips.push(`<a class="btn ghost wl-bundle-chip" href="${escapeHtml(bnd.url)}"
      target="_blank" rel="noopener" title="${escapeHtml(bnd.title || "")}">🎁 In a bundle ↗</a>`);
  }
  const line = wishlistPriceLine(row);
  if (!chips.length && !line) return "";
  // "Deal" only when there's actually something dealy — a discount, an all-time
  // low, a bundle, or free. At plain regular price the section is just the price
  // and where to buy it, so don't oversell it.
  const isDeal = !!bnd || (p && (p.cut > 0 || p.atLow || p.current === 0));
  return `<div class="hltb wl-deal">
    <div class="hltb-head">${icon("i-star", 14)} ${isDeal ? "Deal" : "Where to buy"}</div>
    ${line}
    ${bnd && bnd.title ? `<div class="wl-bundle-line">In a bundle: <b>${escapeHtml(bnd.title)}</b></div>` : ""}
    ${chips.length ? `<div class="wl-deal-chips">${chips.join("")}</div>` : ""}
  </div>`;
}

// Admin: map a wishlist-only row that DIDN'T match to an IGDB game, by pasting
// its URL. Only the completely unmapped ones — a matched item has an IGDB detail
// panel, whose own "Fix mapping" section already handles remapping it, so
// showing this too would be a redundant second box on every matched wish.
function wishlistMapHtml(row) {
  if (!IS_ADMIN || !row._wlOnly || !row._wlAppIds || row._igdbId) return "";
  return `<div class="hltb wl-map" data-wl-appids='${escapeHtml(JSON.stringify(row._wlAppIds))}'>
    <div class="hltb-head">${icon("i-edit", 14)} Map to an IGDB game</div>
    <div class="map-src"><label>IGDB game URL</label>
      <div class="map-row">
        <input type="url" placeholder="igdb.com/games/&lt;slug&gt;" data-wl-map-input>
        <button class="btn" data-wl-map-go>Map</button>
      </div>
      <p class="auth-err" data-wl-map-err hidden></p>
    </div>
  </div>`;
}

// The price BADGE on a card cover: current price, the cut %, and an all-time-low
// star. Positioned (CSS) over the bottom of the cover so it reads at a glance.
// "" for a row with no price (non-Steam wishlist, or ITAD had nothing).
function wishlistPriceBadge(row) {
  const p = row._wlPrice;
  if (!p || p.current == null) return "";
  const cur = _money(p.current, p.currency);
  const cut = p.cut > 0 ? `<i class="wl-cut">−${p.cut}%</i>` : "";
  const star = p.atLow ? ` ★` : "";
  const cls = p.atLow ? " atlow" : (p.cut > 0 ? " sale" : "");
  const tip = [p.regular != null && p.cut > 0 ? `was ${_money(p.regular, p.currency)}` : null,
               p.shop ? `on ${p.shop}` : null,
               p.low != null ? `all-time low ${_money(p.low, p.currency)}` : null,
               p.voucher ? `coupon ${p.voucher}` : null].filter(Boolean).join(" · ");
  return `<span class="card-price${cls}" title="${escapeHtml(tip)}">${cut}${escapeHtml(cur)}${star}</span>`;
}

// The fuller price line for the drawer: regular slashed, current, cut, store,
// coupon, all-time low.
function wishlistPriceLine(row) {
  const p = row._wlPrice;
  if (!p || p.current == null) return "";
  const onSale = p.cut > 0 && p.regular != null;
  const reg = onSale ? `<s>${escapeHtml(_money(p.regular, p.currency))}</s> ` : "";
  const cut = onSale ? ` <b class="wl-cut">−${p.cut}%</b>` : "";
  const shop = p.shop ? ` <span class="muted">on ${escapeHtml(p.shop)}</span>` : "";
  const low = p.atLow ? ` <span class="wl-low">★ all-time low</span>`
    : (p.low != null ? ` <span class="muted">· low ${escapeHtml(_money(p.low, p.currency))}</span>` : "");
  const coupon = p.voucher ? ` <span class="wl-coupon" title="Apply at checkout">🎟 ${escapeHtml(p.voucher)}</span>` : "";
  return `<div class="wl-price-line">${reg}<b>${escapeHtml(_money(p.current, p.currency))}</b>${cut}${shop}${low}${coupon}</div>`;
}
