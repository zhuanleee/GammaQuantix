// Gamma Quantix - Complete Options Flow & GEX Analysis
// Version: 2.0.0
console.log('Gamma Quantix v2.0.0 loaded');

// Swing Mode toggle helpers
function isSwingMode() { return localStorage.getItem('gq_swing_mode') === 'true'; }
function onSwingModeToggle() {
    localStorage.setItem('gq_swing_mode', document.getElementById('xray-swing-mode')?.checked ? 'true' : 'false');
}

// Tooltip system: converts title → data-tip, appends tooltip div to body (escapes overflow:hidden)
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[title]').forEach(el => {
        if (el.title && el.title.length > 0) {
            el.setAttribute('data-tip', el.title);
            el.removeAttribute('title');
        }
    });

    let tipEl = null;
    let tipTimeout = null;

    document.addEventListener('mouseover', e => {
        const target = e.target.closest('[data-tip]');
        if (!target || !target.getAttribute('data-tip')) return;
        clearTimeout(tipTimeout);
        if (!tipEl) {
            tipEl = document.createElement('div');
            tipEl.className = 'gq-tooltip';
            document.body.appendChild(tipEl);
        }
        tipEl.textContent = target.getAttribute('data-tip');
        tipEl.classList.remove('visible');
        const rect = target.getBoundingClientRect();
        // Position above by default
        tipEl.style.left = rect.left + rect.width / 2 + 'px';
        tipEl.style.transform = 'translateX(-50%)';
        tipEl.style.top = (rect.top - 8) + 'px';
        // Measure and adjust
        requestAnimationFrame(() => {
            const tipRect = tipEl.getBoundingClientRect();
            if (tipRect.top < 4) {
                // Show below if no room above
                tipEl.style.top = (rect.bottom + 8) + 'px';
            } else {
                tipEl.style.top = (rect.top - 8 - tipRect.height) + 'px';
            }
            // Keep within horizontal bounds
            const tr = tipEl.getBoundingClientRect();
            if (tr.right > window.innerWidth - 8) {
                tipEl.style.left = (window.innerWidth - 8 - tr.width / 2) + 'px';
            }
            if (tr.left < 8) {
                tipEl.style.left = (8 + tr.width / 2) + 'px';
            }
            tipEl.classList.add('visible');
        });
    });

    document.addEventListener('mouseout', e => {
        const target = e.target.closest('[data-tip]');
        if (!target) return;
        tipTimeout = setTimeout(() => {
            if (tipEl) tipEl.classList.remove('visible');
        }, 100);
    });
});

// API Configuration
const API_BASE = 'https://zhuanleee--stockstory-api-create-fastapi-app.modal.run';

// API response cache (avoids duplicate fetches within the same load cycle)
const _apiCache = new Map();
const _API_CACHE_TTL = 30000; // 30s

function cacheApiResponse(url, data) {
    _apiCache.set(url, { data, ts: Date.now() });
}

function getCachedApiResponse(url) {
    const entry = _apiCache.get(url);
    if (entry && (Date.now() - entry.ts) < _API_CACHE_TTL) return entry.data;
    _apiCache.delete(url);
    return null;
}

// Global State
let optionsAnalysisTicker = '';
let isSyncingExpiry = false;
let optionsChartData = { painByStrike: [], gexByStrike: [], maxPainPrice: 0, currentPrice: 0 };
let activeOptionsChart = 'maxpain';

// Options Visualization State
let optionsVizChart = null;
let priceChart = null;
let priceSeries = null;
let priceLines = {};
let livePriceInterval = null;
let livePriceWs = null;
let wsRetries = 0;
const MAX_WS_RETRIES = 2;

let optionsVizData = {
    gexByStrike: [],
    callOI: [],
    putOI: [],
    strikes: [],
    currentPrice: 0,
    callWall: 0,
    putWall: 0,
    gammaFlip: 0,
    maxPain: 0,
    expectedMove: { upper: 0, lower: 0 },
    totalGex: 0,
    pcRatio: 0,
    candles: [],
    val: 0,
    poc: 0,
    vah: 0,
    vpPosition: 'In Range',
    // Intelligence overlays
    expectedMoveData: null,
    gexRegime: null,
    vrpData: null,
    vannaCharmData: null
};

// Technical indicator state
let volumeSeries = null;
let indicatorSeries = {};    // {sma20, sma50, sma200, vwap, bbMiddle, bbUpper, bbLower}
let rsiChart = null;
let rsiSeries = null;
let rsChart = null;
let rsSeries = null;
let rsSmaSeries = null;
let cotChart = null;
let cotCat1Series = null;
let cotCat2Series = null;
let cotCat3Series = null;
let cotData = null;
let vpCanvas = null;
let vpCtx = null;
let vpProfileData = null;  // {bins, pocIndex, valIndex, vahIndex, maxVolume}
let vpTooltip = null;
let vpRedrawTimer = null;
let vpLastRangeKey = null;  // cache key for visible range
let selectedInterval = localStorage.getItem('gq_interval') || '1d';
const INTERVAL_DAYS_MAP = {
    '1m': 1, '5m': 5, '15m': 10, '30m': 15,
    '1h': 30, '4h': 60, '1d': null, '1w': null
};

// Toggle persistence
const TOGGLE_IDS = [
    'viz-toggle-callwall','viz-toggle-putwall','viz-toggle-gammaflip','viz-toggle-maxpain',
    'viz-toggle-val','viz-toggle-poc','viz-toggle-vah','viz-toggle-vp','viz-toggle-gex',
    'viz-toggle-sma20','viz-toggle-sma50','viz-toggle-sma200','viz-toggle-vwap','viz-toggle-bb',
    'viz-toggle-rsi','viz-toggle-rs','viz-toggle-cot','viz-toggle-volume','viz-toggle-flow',
    'viz-toggle-em','viz-toggle-regime','viz-toggle-vrp','viz-toggle-gexheat','viz-toggle-toxicity','viz-toggle-dealer'
];

function saveToggles() {
    var state = {};
    TOGGLE_IDS.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) state[id] = el.checked;
    });
    localStorage.setItem('gq_toggles', JSON.stringify(state));
}

function restoreToggles() {
    var raw = localStorage.getItem('gq_toggles');
    if (!raw) return;
    try {
        var state = JSON.parse(raw);
        TOGGLE_IDS.forEach(function(id) {
            var el = document.getElementById(id);
            if (el && state[id] !== undefined) el.checked = state[id];
        });
    } catch(e) {}
}

// Tab state
let activeTab = 'tab-analysis';
let ivSmileChart = null;

// Futures specifications
const FUTURES_SPECS = {
    '/ES': { name: 'E-mini S&P 500', multiplier: 50 },
    '/NQ': { name: 'E-mini Nasdaq', multiplier: 20 },
    '/CL': { name: 'Crude Oil', multiplier: 1000 },
    '/GC': { name: 'Gold', multiplier: 100 },
    '/SI': { name: 'Silver', multiplier: 5000 },
    '/RTY': { name: 'E-mini Russell 2000', multiplier: 50 }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set up enter key handlers for both inputs
    document.getElementById('ticker-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadOptionsAnalysis();
    });

    // Sync header input to action bar on change
    document.getElementById('ticker-input').addEventListener('input', () => {
        const actionInput = document.getElementById('options-ticker-input');
        if (actionInput) actionInput.value = document.getElementById('ticker-input').value;
    });

    // Restore Swing Mode toggle state
    const swingCheckbox = document.getElementById('xray-swing-mode');
    if (swingCheckbox) swingCheckbox.checked = isSwingMode();

    // Load market sentiment
    loadMarketSentiment();
    updateMarketStatus();

    // Update market status every minute
    setInterval(updateMarketStatus, 60000);

    // Restore saved interval button highlight
    if (selectedInterval !== '1d') {
        document.querySelectorAll('.interval-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.textContent.trim().toLowerCase() === selectedInterval) btn.classList.add('active');
        });
    }

    // Restore toggle states and timeframe from localStorage
    restoreToggles();
    restoreTogglePreset();
    var savedTimeframe = localStorage.getItem('gq_timeframe');
    var tfSelect = document.getElementById('viz-timeframe');
    if (savedTimeframe && tfSelect) tfSelect.value = savedTimeframe;

    // Save toggles on any change
    TOGGLE_IDS.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', saveToggles);
    });

    // Restore saved ticker and tab from localStorage
    const savedTicker = localStorage.getItem('gq_ticker');
    const savedTab = localStorage.getItem('gq_tab');

    // Restore tab first so loadOptionsAnalysis doesn't override it
    if (savedTab) {
        activeTab = savedTab;
        showTab(savedTab);
    }

    if (savedTicker) {
        document.getElementById('ticker-input').value = savedTicker;
        const actionInput = document.getElementById('options-ticker-input');
        if (actionInput) actionInput.value = savedTicker;
        document.querySelectorAll('.ticker-btn').forEach(btn => {
            if (btn.textContent.trim() === savedTicker) btn.style.background = 'var(--blue-bg)';
        });
        loadOptionsAnalysis();
    }
});

// =============================================================================
// MARKET STATUS
// =============================================================================
function updateMarketStatus() {
    const now = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/New_York'}));
    const day = now.getDay();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const time = hours * 60 + minutes;

    const marketOpen = 9 * 60 + 30; // 9:30 AM
    const marketClose = 16 * 60; // 4:00 PM

    const isWeekday = day >= 1 && day <= 5;
    const isDuringHours = time >= marketOpen && time < marketClose;
    const isOpen = isWeekday && isDuringHours;

    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('status-text');

    if (isOpen) {
        statusDot.classList.remove('closed');
        statusText.textContent = 'Market Open';
    } else {
        statusDot.classList.add('closed');
        statusText.textContent = 'Market Closed';
    }

    document.getElementById('last-update').textContent = `Last update: ${now.toLocaleTimeString()}`;
}

// =============================================================================
// HELPERS
// =============================================================================
function getFuturesInfo(ticker) {
    const upper = ticker.toUpperCase();
    const spec = FUTURES_SPECS[upper] || FUTURES_SPECS['/' + upper] || FUTURES_SPECS[upper.replace('/', '')];
    return spec
        ? { isFutures: true, name: spec.name, multiplier: spec.multiplier }
        : { isFutures: ticker.startsWith('/'), name: 'Futures', multiplier: 50 };
}

function formatExpirationOptions(expirations, selectedIndex = 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Auto-select first non-expired expiration if default would be expired
    if (selectedIndex === 0) {
        for (let i = 0; i < expirations.length; i++) {
            const exp = typeof expirations[i] === 'string' ? expirations[i] : expirations[i].date;
            if (exp > todayStr) { selectedIndex = i; break; }
        }
    }

    const groups = {
        thisWeek: [],
        nextWeek: [],
        thisMonth: [],
        nextMonth: [],
        quarterly: [],
        leaps: []
    };

    expirations.forEach((exp, i) => {
        const expDate = typeof exp === 'string' ? exp : exp.date;
        const d = new Date(expDate + 'T00:00:00');
        const daysOut = typeof exp === 'object' && exp.dte !== undefined ? exp.dte : Math.round((d - today) / (1000 * 60 * 60 * 24));
        const isMonthly = d.getDate() >= 15 && d.getDate() <= 21 && d.getDay() === 5;
        const isQuarterly = [2, 5, 8, 11].includes(d.getMonth()) && isMonthly;

        const label = daysOut <= 0 ? `${months[d.getMonth()]} ${d.getDate()} (0DTE)` :
                     daysOut === 1 ? `${months[d.getMonth()]} ${d.getDate()} (1d)` :
                     `${months[d.getMonth()]} ${d.getDate()} (${daysOut}d)`;

        const option = { value: expDate, label, daysOut, isSelected: i === selectedIndex };

        if (daysOut <= 7) groups.thisWeek.push(option);
        else if (daysOut <= 14) groups.nextWeek.push(option);
        else if (daysOut <= 30) groups.thisMonth.push(option);
        else if (daysOut <= 60) groups.nextMonth.push(option);
        else if (daysOut <= 180 || isQuarterly) groups.quarterly.push(option);
        else groups.leaps.push(option);
    });

    let html = '';
    if (groups.thisWeek.length > 0) {
        html += '<optgroup label="This Week">';
        html += groups.thisWeek.map(o => `<option value="${o.value}" ${o.isSelected ? 'selected' : ''}>${o.label}</option>`).join('');
        html += '</optgroup>';
    }
    if (groups.nextWeek.length > 0) {
        html += '<optgroup label="Next Week">';
        html += groups.nextWeek.map(o => `<option value="${o.value}" ${o.isSelected ? 'selected' : ''}>${o.label}</option>`).join('');
        html += '</optgroup>';
    }
    if (groups.thisMonth.length > 0) {
        html += '<optgroup label="This Month">';
        html += groups.thisMonth.map(o => `<option value="${o.value}" ${o.isSelected ? 'selected' : ''}>${o.label}</option>`).join('');
        html += '</optgroup>';
    }
    if (groups.nextMonth.length > 0) {
        html += '<optgroup label="Next Month">';
        html += groups.nextMonth.map(o => `<option value="${o.value}" ${o.isSelected ? 'selected' : ''}>${o.label}</option>`).join('');
        html += '</optgroup>';
    }
    if (groups.quarterly.length > 0) {
        html += '<optgroup label="Quarterly">';
        html += groups.quarterly.slice(0, 8).map(o => `<option value="${o.value}" ${o.isSelected ? 'selected' : ''}>${o.label}</option>`).join('');
        html += '</optgroup>';
    }
    if (groups.leaps.length > 0) {
        html += '<optgroup label="LEAPS">';
        html += groups.leaps.slice(0, 6).map(o => `<option value="${o.value}" ${o.isSelected ? 'selected' : ''}>${o.label}</option>`).join('');
        html += '</optgroup>';
    }
    return html;
}

// =============================================================================
// QUICK TICKER
// =============================================================================
function quickAnalyzeTicker(ticker) {
    document.getElementById('ticker-input').value = ticker;
    const actionInput = document.getElementById('options-ticker-input');
    if (actionInput) actionInput.value = ticker;
    document.querySelectorAll('.ticker-btn').forEach(btn => btn.style.background = '');
    event.target.style.background = 'var(--blue-bg)';
    loadOptionsAnalysis();
}

// =============================================================================
// OPTIONS ANALYSIS
// =============================================================================
async function loadOptionsAnalysis() {
    // Check both header and action bar inputs
    const headerInput = document.getElementById('ticker-input');
    const actionInput = document.getElementById('options-ticker-input');
    let ticker = headerInput.value.trim().toUpperCase();
    if (!ticker && actionInput) ticker = actionInput.value.trim().toUpperCase();
    if (!ticker) {
        alert('Please enter a ticker symbol');
        return;
    }
    // Sync both inputs
    headerInput.value = ticker;
    if (actionInput) actionInput.value = ticker;

    optionsAnalysisTicker = ticker;
    localStorage.setItem('gq_ticker', ticker);

    // Switch to Analysis tab only on first load; otherwise stay on current tab
    if (!activeTab || activeTab === 'tab-analysis') showTab('tab-analysis');

    const container = document.getElementById('options-analysis-container');
    container.style.display = 'block';

    const futuresInfo = getFuturesInfo(ticker);
    const tickerEl = document.getElementById('oa-ticker');
    if (futuresInfo.isFutures) {
        tickerEl.innerHTML = `${ticker} <span style="font-size: 0.65rem; padding: 2px 6px; background: var(--orange); color: white; border-radius: 4px; margin-left: 4px;">FUTURES</span>`;
    } else {
        tickerEl.textContent = ticker;
    }
    document.getElementById('oa-interpretation').textContent = 'Loading analysis...';

    const expirySelect = document.getElementById('oa-expiry-select');
    expirySelect.innerHTML = '<option value="">Loading...</option>';

    try {
        const expUrl = ticker.startsWith('/')
            ? `${API_BASE}/options/expirations?ticker=${encodeURIComponent(ticker)}`
            : `${API_BASE}/options/expirations/${ticker}`;
        const expRes = await fetch(expUrl);
        const expData = await expRes.json();

        if (expData.ok && expData.data && expData.data.expirations) {
            const expirations = expData.data.expirations;
            expirySelect.innerHTML = formatExpirationOptions(expirations, 0);
            // Sync X-Ray expiry selector
            syncXrayExpirySelect(expirations);
            await loadOptionsForExpiry();
        } else {
            expirySelect.innerHTML = '<option value="">No expirations</option>';
            throw new Error('Could not load expirations');
        }
    } catch (e) {
        console.error('Failed to load options analysis:', e);
        document.getElementById('oa-interpretation').textContent = 'Error: ' + e.message;
        document.getElementById('oa-sentiment').textContent = 'ERROR';
        document.getElementById('oa-sentiment').style.background = 'rgba(239,68,68,0.2)';
        document.getElementById('oa-sentiment').style.color = 'var(--red)';
    }

    // Always load chart visualization regardless of analysis errors
    loadOptionsViz(optionsAnalysisTicker);
}

// =============================================================================
// OPTIONS FOR EXPIRY
// =============================================================================
async function loadOptionsForExpiry() {
    const ticker = optionsAnalysisTicker;
    const expiry = document.getElementById('oa-expiry-select').value;

    if (!ticker) return;

    const futuresInfo = getFuturesInfo(ticker);

    // Sync expirations
    if (ticker === 'SPY' && expiry && !isSyncingExpiry) {
        const marketExpirySelect = document.getElementById('market-sentiment-expiry');
        if (marketExpirySelect && marketExpirySelect.value !== expiry) {
            const options = Array.from(marketExpirySelect.options).map(o => o.value);
            if (options.includes(expiry)) {
                isSyncingExpiry = true;
                marketExpirySelect.value = expiry;
                loadMarketSentimentForExpiry().finally(() => { isSyncingExpiry = false; });
            }
        }
    }

    try {
        const isFutures = ticker.startsWith('/');
        const tickerParam = encodeURIComponent(ticker);
        const expiryParam = expiry ? `${isFutures ? '&' : '?'}expiration=${expiry}` : '';

        const sentimentUrl = isFutures ? `${API_BASE}/options/sentiment?ticker=${tickerParam}` : `${API_BASE}/options/sentiment/${ticker}`;
        const flowUrl = isFutures ? `${API_BASE}/options/flow?ticker=${tickerParam}` : `${API_BASE}/options/flow/${ticker}`;
        const gexUrl = isFutures ? `${API_BASE}/options/gex?ticker=${tickerParam}${expiryParam}` : `${API_BASE}/options/gex/${ticker}${expiry ? '?expiration=' + expiry : ''}`;
        const maxPainUrl = isFutures
            ? `${API_BASE}/options/max-pain?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/max-pain/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        showSkeleton('oa-metrics-container', 'metrics-grid');
        const [sentimentRes, flowRes, gexRes, maxPainRes] = await Promise.all([
            fetch(sentimentUrl),
            fetch(flowUrl),
            fetch(gexUrl),
            fetch(maxPainUrl).catch(e => null)
        ]);

        const sentimentData = await sentimentRes.json();
        const flowData = await flowRes.json();
        const gexData = await gexRes.json();
        cacheApiResponse(gexUrl, gexData);
        let maxPainData = {};
        if (maxPainRes && maxPainRes.ok) {
            maxPainData = await maxPainRes.json();
            cacheApiResponse(maxPainUrl, maxPainData);
        }
        const mp = maxPainData.data || {};

        const sentiment = sentimentData.data || {};
        const flow = flowData.data || {};
        const gex = gexData.data || {};
        hideSkeleton('oa-metrics-container');

        // P/C Ratio
        const callOI = gex.total_call_oi || 0;
        const putOI = gex.total_put_oi || 0;
        const pcRatio = callOI > 0 ? (putOI / callOI) : (flow.put_call_ratio || 0);
        document.getElementById('oa-pc-ratio').textContent = pcRatio.toFixed(2);
        let pcLabel = 'Neutral', pcColor = 'var(--text)';
        if (pcRatio < 0.7) { pcLabel = 'Bullish'; pcColor = 'var(--green)'; }
        else if (pcRatio > 1.0) { pcLabel = 'Bearish'; pcColor = 'var(--red)'; }
        document.getElementById('oa-pc-label').textContent = pcLabel;
        document.getElementById('oa-pc-label').style.color = pcColor;
        document.getElementById('oa-pc-ratio').style.color = pcColor;

        // GEX
        let gexValue = gex.total_gex || 0;
        if (typeof gexValue === 'object') gexValue = gexValue.total || 0;
        let gexDisplay = Math.abs(gexValue) >= 1e9 ? `$${(gexValue / 1e9).toFixed(1)}B` :
                         Math.abs(gexValue) >= 1e6 ? `$${(gexValue / 1e6).toFixed(1)}M` :
                         `$${(gexValue / 1e3).toFixed(0)}K`;
        document.getElementById('oa-gex').textContent = gexDisplay;
        const gexLabel = gexValue > 0 ? 'Stabilizing' : gexValue < 0 ? 'Volatile' : 'Neutral';
        const gexColor = gexValue > 0 ? 'var(--green)' : gexValue < 0 ? 'var(--red)' : 'var(--text)';
        document.getElementById('oa-gex-label').textContent = gexLabel;
        document.getElementById('oa-gex-label').style.color = gexColor;
        document.getElementById('oa-gex').style.color = gexColor;

        // IV Rank
        const ivRank = sentiment.iv_rank;
        const ivRankEl = document.getElementById('oa-iv-rank');
        if (ivRank != null && ivRank > 0) {
            ivRankEl.textContent = `${ivRank.toFixed(0)}%`;
            ivRankEl.title = '';
            ivRankEl.style.opacity = '';
        } else {
            ivRankEl.textContent = 'N/A';
            ivRankEl.title = 'IV Rank not available — requires historical IV data';
            ivRankEl.style.opacity = '0.5';
        }
        let ivLabel = 'Normal', ivColor = 'var(--text)';
        if (ivRank != null && ivRank > 50) { ivLabel = 'High (Sell)'; ivColor = 'var(--orange)'; }
        else if (ivRank != null && ivRank < 20) { ivLabel = 'Low (Buy)'; ivColor = 'var(--green)'; }
        else if (ivRank == null) { ivLabel = 'N/A'; ivColor = 'var(--text-dim)'; }
        document.getElementById('oa-iv-label').textContent = ivLabel;
        document.getElementById('oa-iv-label').style.color = ivColor;

        // Max Pain
        const maxPainPrice = mp.max_pain_price || mp.max_pain || 0;
        const maxPainEl = document.getElementById('oa-max-pain');
        if (maxPainEl) {
            if (maxPainPrice > 0) {
                maxPainEl.textContent = `$${maxPainPrice.toFixed(0)}`;
                maxPainEl.title = '';
            } else {
                maxPainEl.textContent = 'N/A';
                maxPainEl.title = 'Max Pain unavailable for this expiration';
                maxPainEl.style.opacity = '0.5';
            }
        }
        const mpDistEl = document.getElementById('oa-mp-distance');

        // Current Price
        let currentPrice = gex.current_price || flow.current_price || sentiment.current_price || 0;
        if (currentPrice === 0 && optionsVizData.candles && optionsVizData.candles.length > 0) {
            currentPrice = optionsVizData.candles[optionsVizData.candles.length - 1].close || 0;
        }
        document.getElementById('oa-current-price').textContent = currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : '--';

        // Max Pain distance (needs currentPrice)
        if (mpDistEl && maxPainPrice > 0 && currentPrice > 0) {
            const mpDist = ((maxPainPrice - currentPrice) / currentPrice * 100);
            mpDistEl.textContent = `${mpDist >= 0 ? '+' : ''}${mpDist.toFixed(1)}%`;
            mpDistEl.style.color = Math.abs(mpDist) < 2 ? 'var(--green)' : Math.abs(mpDist) < 5 ? 'var(--yellow)' : 'var(--text-muted)';
        }

        // DTE
        const dte = gex.days_to_expiry || 0;
        const dteText = dte === 0 ? '0DTE' : dte === 1 ? '1 day' : `${dte} days`;
        document.getElementById('oa-dte').textContent = dteText;
        document.getElementById('oa-dte').style.color = dte <= 2 ? 'var(--red)' : dte <= 5 ? 'var(--yellow)' : 'var(--text-muted)';

        // OI
        document.getElementById('oa-call-oi').textContent = callOI.toLocaleString();
        document.getElementById('oa-put-oi').textContent = putOI.toLocaleString();

        // Expiry display
        if (gex.expiration) {
            const expDate = new Date(gex.expiration + 'T00:00:00');
            document.getElementById('oa-expiry-display').textContent = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        // Overall Sentiment Badge
        const overallSentiment = pcRatio < 0.7 && gexValue > 0 ? 'bullish' :
                                pcRatio > 1.0 && gexValue < 0 ? 'bearish' : 'neutral';
        const sentBadge = document.getElementById('oa-sentiment');
        sentBadge.textContent = overallSentiment.toUpperCase();
        sentBadge.style.background = overallSentiment === 'bullish' ? 'rgba(34,197,94,0.2)' :
                                     overallSentiment === 'bearish' ? 'rgba(239,68,68,0.2)' : 'rgba(100,116,139,0.2)';
        sentBadge.style.color = overallSentiment === 'bullish' ? 'var(--green)' :
                                overallSentiment === 'bearish' ? 'var(--red)' : 'var(--text-muted)';

        // Interpretation
        let interpretation = '';
        if (pcRatio < 0.7 && gexValue > 0) {
            interpretation = `Bullish: Low P/C (${pcRatio.toFixed(2)}) + Positive GEX dampens selloffs.`;
        } else if (pcRatio > 1.0 && gexValue < 0) {
            interpretation = `Bearish: High P/C (${pcRatio.toFixed(2)}) + Negative GEX amplifies moves.`;
        } else if (gexValue < 0) {
            interpretation = `Volatile: Negative GEX (${gexDisplay}) = larger swings.`;
        } else {
            interpretation = `Neutral: P/C ${pcRatio.toFixed(2)}, GEX ${gexDisplay}.`;
        }
        if (ivRank > 50) interpretation += ` High IV (${ivRank.toFixed(0)}%) favors selling.`;
        else if (ivRank < 20) interpretation += ` Low IV (${ivRank.toFixed(0)}%) = cheap options.`;

        if (maxPainPrice > 0 && currentPrice > 0) {
            const mpDist = ((maxPainPrice - currentPrice) / currentPrice * 100);
            interpretation += ` Max Pain $${maxPainPrice.toFixed(0)} (${mpDist >= 0 ? '+' : ''}${mpDist.toFixed(1)}%).`;
        }

        if (futuresInfo.isFutures) {
            interpretation = `${futuresInfo.name} Options (${futuresInfo.multiplier}x). ` + interpretation;
        }

        document.getElementById('oa-interpretation').textContent = interpretation;

        // Store chart data for Max Pain / GEX toggle
        optionsChartData.currentPrice = currentPrice;
        optionsChartData.maxPainPrice = maxPainPrice;
        optionsChartData.painByStrike = mp.pain_by_strike || [];
        optionsChartData.gexByStrike = (gex.gex_by_strike || []).map(s => ({
            strike: s.strike,
            netGex: s.net_gex || 0,
            callGex: s.call_gex || 0,
            putGex: s.put_gex || 0
        }));

        // Render the active chart
        if (activeOptionsChart === 'gex') {
            showOptionsChart('gex');
        } else {
            showOptionsChart('maxpain');
        }

        console.log('Options analysis loaded for', ticker);


        // Load GEX Dashboard
        loadGexDashboard();

        // Render Expected Move card
        const atmIV = sentiment.current_iv || sentiment.atm_iv || sentiment.iv_30 || (sentiment.skew && sentiment.skew.call_iv) || 0;
        if (currentPrice > 0 && atmIV > 0) {
            renderExpectedMove(currentPrice, atmIV, Math.max(dte, 1));
        }

        // F9: Load term structure
        loadTermStructure(ticker);

    } catch (e) {
        console.error('Failed to load options data:', e);
        hideSkeleton('oa-metrics-container');
        const detail = e.message && e.message.includes('404') ? 'Ticker not found' :
                       e.message && e.message.includes('timeout') ? 'Request timed out — try again' :
                       'API temporarily unavailable';
        showErrorState('oa-metrics-container', detail, () => loadOptionsForExpiry());
        document.getElementById('oa-interpretation').textContent = 'Error: ' + e.message;
    }
}

// =============================================================================
// SELECT EXPIRY BY DAYS
// =============================================================================
function selectExpiryByDays(targetDays) {
    if (!optionsAnalysisTicker) {
        alert('Please analyze a ticker first');
        return;
    }

    const expirySelect = document.getElementById('oa-expiry-select');
    const options = Array.from(expirySelect.querySelectorAll('option')).filter(o => o.value);

    if (options.length === 0) {
        alert('No expirations available');
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let bestOption = options[0];
    let bestDiff = Infinity;

    options.forEach(opt => {
        const expDate = new Date(opt.value + 'T00:00:00');
        const daysOut = Math.round((expDate - today) / (1000 * 60 * 60 * 24));
        const diff = Math.abs(daysOut - targetDays);

        if (diff < bestDiff) {
            bestDiff = diff;
            bestOption = opt;
        }
    });

    expirySelect.value = bestOption.value;
    loadOptionsForExpiry();
}

// =============================================================================
// GEX DASHBOARD
// =============================================================================
async function loadGexDashboard() {
    const ticker = optionsAnalysisTicker;
    if (!ticker) return;

    const expiry = document.getElementById('oa-expiry-select').value;
    const container = document.getElementById('gex-dashboard-container');
    container.style.display = 'block';
    showSkeleton('gex-regime-container', 'card');
    showSkeleton('gex-levels-container', 'card');
    document.getElementById('gex-ticker').textContent = ticker;

    // Reset retry flag and fields
    window._combinedRetried = false;
    const resetFields = ['gex-regime-badge', 'gex-regime-confidence', 'gex-regime-strategy',
        'gex-regime-recommendation', 'combined-regime-badge', 'combined-risk-level',
        'combined-position-size', 'combined-recommendation', 'gex-call-wall', 'gex-put-wall',
        'gex-gamma-flip', 'gex-pc-zscore', 'gex-pc-sentiment', 'gex-magnet-zones',
        'gex-accel-zones', 'gex-signal-badge', 'gex-signal-note', 'gex-interpretation'];
    resetFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Loading...';
    });

    try {
        const isFutures = ticker.startsWith('/');
        const expiryParam = expiry ? `&expiration=${expiry}` : '';
        const gexLevelsUrl = isFutures
            ? `${API_BASE}/options/gex-levels?ticker=${encodeURIComponent(ticker)}${expiryParam}`
            : `${API_BASE}/options/gex-levels/${ticker}${expiry ? '?expiration=' + expiry : ''}`;
        const [regimeRes, levelsRes, combinedRes] = await Promise.all([
            fetch(isFutures
                ? `${API_BASE}/options/gex-regime?ticker=${encodeURIComponent(ticker)}${expiryParam}`
                : `${API_BASE}/options/gex-regime/${ticker}${expiry ? '?expiration=' + expiry : ''}`),
            fetch(gexLevelsUrl),
            fetch(isFutures
                ? `${API_BASE}/options/combined-regime?ticker=${encodeURIComponent(ticker)}${expiryParam}`
                : `${API_BASE}/options/combined-regime/${ticker}${expiry ? '?expiration=' + expiry : ''}`)
        ]);

        const regimeData = await regimeRes.json();
        const levelsData = await levelsRes.json();
        cacheApiResponse(gexLevelsUrl, levelsData);
        const combinedData = await combinedRes.json();
        hideSkeleton('gex-regime-container');
        hideSkeleton('gex-levels-container');

        // Update Volatility Regime
        if (regimeData.ok && regimeData.data) {
            const r = regimeData.data;
            const regimeBadge = document.getElementById('gex-regime-badge');
            regimeBadge.textContent = (r.regime || '--').toUpperCase();

            if (r.regime === 'pinned') {
                regimeBadge.style.background = 'rgba(34, 197, 94, 0.2)';
                regimeBadge.style.color = 'var(--green)';
            } else if (r.regime === 'volatile') {
                regimeBadge.style.background = 'rgba(239, 68, 68, 0.2)';
                regimeBadge.style.color = 'var(--red)';
            } else {
                regimeBadge.style.background = 'rgba(251, 191, 36, 0.2)';
                regimeBadge.style.color = 'var(--orange)';
            }

            document.getElementById('gex-regime-confidence').textContent =
                r.confidence ? `${(r.confidence * 100).toFixed(0)}%` : '--';
            document.getElementById('gex-regime-strategy').textContent =
                r.strategy_bias === 'mean_revert' ? 'Mean Revert' :
                r.strategy_bias === 'trend_follow' ? 'Trend Follow' : r.strategy_bias || '--';
            document.getElementById('gex-regime-recommendation').textContent =
                r.recommendation || '--';
        }

        // Update Combined Regime
        if (combinedData.ok && combinedData.data) {
            const c = combinedData.data;
            const combinedBadge = document.getElementById('combined-regime-badge');
            combinedBadge.textContent = (c.combined_regime || '--').toUpperCase().replace('_', ' ');

            const regimeColors = {
                'opportunity': { bg: 'rgba(34, 197, 94, 0.2)', color: 'var(--green)' },
                'melt_up': { bg: 'rgba(59, 130, 246, 0.2)', color: 'var(--blue)' },
                'high_risk': { bg: 'rgba(251, 191, 36, 0.2)', color: 'var(--orange)' },
                'danger': { bg: 'rgba(239, 68, 68, 0.2)', color: 'var(--red)' }
            };
            const colors = regimeColors[c.combined_regime] || { bg: 'var(--bg)', color: 'var(--text-muted)' };
            combinedBadge.style.background = colors.bg;
            combinedBadge.style.color = colors.color;

            const riskEl = document.getElementById('combined-risk-level');
            riskEl.textContent = c.risk_level || '--';
            if (c.risk_level === 'low') riskEl.style.color = 'var(--green)';
            else if (c.risk_level === 'medium') riskEl.style.color = 'var(--orange)';
            else if (c.risk_level === 'high' || c.risk_level === 'extreme') riskEl.style.color = 'var(--red)';
            else riskEl.style.color = 'var(--text)';

            document.getElementById('combined-position-size').textContent =
                (c.position_multiplier || c.position_sizing) ? `${((c.position_multiplier || c.position_sizing) * 100).toFixed(0)}%` : '--';
            document.getElementById('combined-recommendation').textContent =
                c.recommendation || '--';

            const zscore = c.pc_zscore;
            const zscoreEl = document.getElementById('gex-pc-zscore');
            zscoreEl.textContent = zscore !== undefined ? zscore.toFixed(2) : '--';
            if (zscore > 1) zscoreEl.style.color = 'var(--red)';
            else if (zscore < -1) zscoreEl.style.color = 'var(--green)';
            else zscoreEl.style.color = 'var(--text)';

            const sentiment = c.pc_sentiment;
            const sentimentEl = document.getElementById('gex-pc-sentiment');
            sentimentEl.textContent = sentiment || '--';
            if (sentiment === 'fear' || (sentiment && sentiment.includes('fear'))) {
                sentimentEl.style.color = 'var(--red)';
            } else if (sentiment === 'complacency' || (sentiment && sentiment.includes('complacency'))) {
                sentimentEl.style.color = 'var(--green)';
            } else {
                sentimentEl.style.color = 'var(--text-muted)';
            }
        } else if (!combinedData.ok) {
            // Retry once on failure (stale container / DXLinkStreamer timeout)
            if (!window._combinedRetried) {
                window._combinedRetried = true;
                setTimeout(() => {
                    const retryUrl = isFutures
                        ? `${API_BASE}/options/combined-regime?ticker=${encodeURIComponent(ticker)}${expiryParam}`
                        : `${API_BASE}/options/combined-regime/${ticker}${expiry ? '?expiration=' + expiry : ''}`;
                    fetch(retryUrl).then(r => r.json()).then(retryData => {
                        if (retryData.ok && retryData.data) {
                            const c = retryData.data;
                            const badge = document.getElementById('combined-regime-badge');
                            badge.textContent = (c.combined_regime || '--').toUpperCase().replace('_', ' ');
                            const regimeColors = {
                                'opportunity': { bg: 'rgba(34, 197, 94, 0.2)', color: 'var(--green)' },
                                'melt_up': { bg: 'rgba(59, 130, 246, 0.2)', color: 'var(--blue)' },
                                'high_risk': { bg: 'rgba(251, 191, 36, 0.2)', color: 'var(--orange)' },
                                'danger': { bg: 'rgba(239, 68, 68, 0.2)', color: 'var(--red)' }
                            };
                            const colors = regimeColors[c.combined_regime] || { bg: 'var(--bg)', color: 'var(--text-muted)' };
                            badge.style.background = colors.bg;
                            badge.style.color = colors.color;
                            document.getElementById('combined-risk-level').textContent = c.risk_level || '--';
                            document.getElementById('combined-position-size').textContent =
                                (c.position_multiplier || c.position_sizing) ? `${((c.position_multiplier || c.position_sizing) * 100).toFixed(0)}%` : '--';
                            document.getElementById('combined-recommendation').textContent = c.recommendation || '--';
                            const zscoreEl = document.getElementById('gex-pc-zscore');
                            zscoreEl.textContent = c.pc_zscore !== undefined ? c.pc_zscore.toFixed(2) : '--';
                            const sentimentEl = document.getElementById('gex-pc-sentiment');
                            sentimentEl.textContent = c.pc_sentiment || '--';
                        } else {
                            // Give up - show dashes
                            document.getElementById('combined-regime-badge').textContent = '--';
                            document.getElementById('combined-risk-level').textContent = '--';
                            document.getElementById('combined-position-size').textContent = '--';
                            document.getElementById('combined-recommendation').textContent = '--';
                            document.getElementById('gex-pc-zscore').textContent = '--';
                            document.getElementById('gex-pc-sentiment').textContent = '--';
                        }
                    }).catch(() => {
                        document.getElementById('combined-regime-badge').textContent = '--';
                        document.getElementById('combined-risk-level').textContent = '--';
                        document.getElementById('combined-position-size').textContent = '--';
                        document.getElementById('combined-recommendation').textContent = '--';
                        document.getElementById('gex-pc-zscore').textContent = '--';
                        document.getElementById('gex-pc-sentiment').textContent = '--';
                    });
                }, 2000);
            }
        }

        // Update GEX Levels
        if (levelsData.ok && levelsData.data) {
            const l = levelsData.data;
            const currentPrice = l.current_price || 0;

            const callWall = l.call_wall;
            document.getElementById('gex-call-wall').textContent =
                callWall ? `$${callWall.toFixed(2)}` : '--';
            if (callWall && currentPrice) {
                const dist = ((callWall - currentPrice) / currentPrice * 100).toFixed(1);
                document.getElementById('gex-call-wall-dist').textContent = `${dist > 0 ? '+' : ''}${dist}% from price`;
            }

            const putWall = l.put_wall;
            document.getElementById('gex-put-wall').textContent =
                putWall ? `$${putWall.toFixed(2)}` : '--';
            if (putWall && currentPrice) {
                const dist = ((putWall - currentPrice) / currentPrice * 100).toFixed(1);
                document.getElementById('gex-put-wall-dist').textContent = `${dist > 0 ? '+' : ''}${dist}% from price`;
            }

            const gammaFlip = l.gamma_flip;
            document.getElementById('gex-gamma-flip').textContent =
                gammaFlip ? `$${gammaFlip.toFixed(2)}` : '--';

            const magnets = l.magnet_zones || [];
            document.getElementById('gex-magnet-zones').textContent =
                magnets.length > 0 ? magnets.map(z => `$${z.toFixed(0)}`).join(', ') : 'None';

            const accels = l.acceleration_zones || [];
            document.getElementById('gex-accel-zones').textContent =
                accels.length > 0 ? accels.map(z => `$${z.toFixed(0)}`).join(', ') : 'None';

            // Trading signal
            const signalBadge = document.getElementById('gex-signal-badge');
            let signal = 'neutral';
            let signalNote = l.interpretation || '--';

            if (callWall && putWall && currentPrice) {
                const distToCall = ((callWall - currentPrice) / currentPrice) * 100;
                const distToPut = ((currentPrice - putWall) / currentPrice) * 100;

                if (distToPut < 2) {
                    signal = 'bullish';
                    signalNote = `Price near put wall support at $${putWall.toFixed(0)}`;
                } else if (distToCall < 2) {
                    signal = 'bearish';
                    signalNote = `Price near call wall resistance at $${callWall.toFixed(0)}`;
                } else if (distToCall < distToPut) {
                    signal = 'bearish';
                    signalNote = `Closer to call wall resistance ($${callWall.toFixed(0)})`;
                } else {
                    signal = 'bullish';
                    signalNote = `Closer to put wall support ($${putWall.toFixed(0)})`;
                }
            }

            signalBadge.textContent = signal.toUpperCase();
            if (signal === 'bullish') {
                signalBadge.style.background = 'rgba(34, 197, 94, 0.2)';
                signalBadge.style.color = 'var(--green)';
            } else if (signal === 'bearish') {
                signalBadge.style.background = 'rgba(239, 68, 68, 0.2)';
                signalBadge.style.color = 'var(--red)';
            } else {
                signalBadge.style.background = 'var(--bg)';
                signalBadge.style.color = 'var(--text-muted)';
            }

            document.getElementById('gex-signal-note').textContent = signalNote;

            // Render GEX Price Ladder
            const priceLadderContainer = document.getElementById('gex-price-ladder-container');
            if (priceLadderContainer) {
                priceLadderContainer.innerHTML = renderGexPriceLadder(l, currentPrice);
            }

            // Render Key Levels Table
            const keyLevels = l.key_levels || [];
            const levelsTableContainer = document.getElementById('gex-levels-table-container');
            const levelsTableBody = document.getElementById('gex-levels-table-body');
            const levelsCount = document.getElementById('gex-levels-count');

            if (levelsTableContainer && levelsTableBody) {
                if (keyLevels.length > 0) {
                    levelsTableContainer.style.display = 'block';
                    levelsTableBody.innerHTML = renderGexLevelsTable(keyLevels, currentPrice);
                    if (levelsCount) {
                        levelsCount.textContent = `${Math.min(keyLevels.length, 10)} levels`;
                    }
                } else {
                    levelsTableContainer.style.display = 'none';
                }
            }
        }

        // Build interpretation
        let interpretation = [];
        if (regimeData.ok && regimeData.data) {
            const r = regimeData.data;
            interpretation.push(`Regime: ${r.regime} (${r.strategy_bias === 'mean_revert' ? 'fade moves' : 'ride trends'}).`);
        }
        if (combinedData.ok && combinedData.data) {
            const c = combinedData.data;
            interpretation.push(`Combined: ${c.combined_regime?.replace('_', ' ')} - ${c.recommendation || ''}`);
        }
        if (levelsData.ok && levelsData.data) {
            const l = levelsData.data;
            if (l.call_wall && l.put_wall) {
                interpretation.push(`Range: $${l.put_wall.toFixed(0)} support to $${l.call_wall.toFixed(0)} resistance.`);
            }
        }

        document.getElementById('gex-interpretation').textContent =
            interpretation.length > 0 ? interpretation.join(' ') : 'GEX analysis loaded.';

        console.log('GEX Dashboard loaded for', ticker);

    } catch (e) {
        console.error('GEX Dashboard error:', e);
        document.getElementById('gex-interpretation').textContent = 'Error loading GEX data: ' + e.message;
    }
}

// =============================================================================
// GEX PRICE LADDER
// =============================================================================
function renderGexPriceLadder(levelsData, currentPrice) {
    if (!levelsData || !currentPrice) {
        return '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No price ladder data available</div>';
    }

    const callWall = levelsData.call_wall;
    const putWall = levelsData.put_wall;
    const callWallGex = levelsData.call_wall_gex_millions || 0;
    const putWallGex = levelsData.put_wall_gex_millions || 0;
    const gammaFlip = levelsData.gamma_flip;

    const calcDist = (price) => {
        if (!price || !currentPrice) return '';
        const dist = ((price - currentPrice) / currentPrice * 100).toFixed(1);
        return dist > 0 ? `+${dist}%` : `${dist}%`;
    };

    const maxGex = Math.max(Math.abs(callWallGex), Math.abs(putWallGex), 1);
    const calcBarWidth = (gex) => Math.min(Math.abs(gex) / maxGex * 100, 100);

    const levels = [];

    if (callWall) {
        levels.push({ type: 'call_wall', label: 'CALL WALL', price: callWall, gex: callWallGex, color: 'var(--red)' });
    }

    if (gammaFlip && gammaFlip !== callWall && gammaFlip !== putWall) {
        levels.push({ type: 'gamma_flip', label: 'GAMMA FLIP', price: gammaFlip, gex: 0, color: 'var(--orange)' });
    }

    if (putWall) {
        levels.push({ type: 'put_wall', label: 'PUT WALL', price: putWall, gex: putWallGex, color: 'var(--green)' });
    }

    levels.sort((a, b) => b.price - a.price);

    let currentInserted = false;
    const sortedWithCurrent = [];

    for (const level of levels) {
        if (!currentInserted && level.price < currentPrice) {
            sortedWithCurrent.push({ type: 'current', price: currentPrice });
            currentInserted = true;
        }
        sortedWithCurrent.push(level);
    }
    if (!currentInserted) {
        sortedWithCurrent.push({ type: 'current', price: currentPrice });
    }

    let html = `
        <div style="background: var(--bg-hover); border-radius: 8px; padding: 16px; margin-top: 16px; margin-bottom: 16px;">
            <div style="font-size: 0.75rem; font-weight: 600; color: var(--orange); margin-bottom: 12px;">
                GEX PRICE LADDER
            </div>
            <div style="display: flex; flex-direction: column; gap: 0;">
    `;

    sortedWithCurrent.forEach((level, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === sortedWithCurrent.length - 1;

        if (level.type === 'current') {
            html += `
                <div style="display: flex; align-items: center; padding: 10px 0; position: relative;">
                    <div style="width: 120px; text-align: right; padding-right: 12px;">
                        <span style="font-size: 0.7rem; font-weight: 600; color: var(--text);">CURRENT</span>
                    </div>
                    <div style="flex: 0 0 20px; display: flex; justify-content: center; position: relative;">
                        <div style="width: 12px; height: 12px; background: var(--text); border-radius: 50%; border: 2px solid var(--bg); z-index: 2;"></div>
                        ${!isFirst ? '<div style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); width: 2px; height: 10px; background: var(--border);"></div>' : ''}
                        ${!isLast ? '<div style="position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); width: 2px; height: 10px; background: var(--border);"></div>' : ''}
                    </div>
                    <div style="flex: 1; padding-left: 12px; display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 1.1rem; font-weight: 700; color: var(--text);">$${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        <span style="font-size: 0.75rem; padding: 2px 8px; background: rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-muted);">NOW</span>
                    </div>
                </div>
            `;
        } else {
            const dist = calcDist(level.price);
            const barWidth = level.gex !== null ? calcBarWidth(level.gex) : 0;
            const barColor = level.gex >= 0 ? 'var(--green)' : 'var(--red)';
            const gexText = level.gex !== null && level.gex !== 0 ? `${level.gex >= 0 ? '+' : ''}${level.gex.toFixed(1)}M GEX` : '';

            html += `
                <div style="display: flex; align-items: center; padding: 8px 0; position: relative;">
                    <div style="width: 120px; text-align: right; padding-right: 12px;">
                        <span style="font-size: 0.65rem; font-weight: 600; color: ${level.color}; letter-spacing: 0.5px;">${level.label}</span>
                    </div>
                    <div style="flex: 0 0 20px; display: flex; justify-content: center; position: relative;">
                        <div style="width: 8px; height: 8px; background: ${level.color}; border-radius: 2px;"></div>
                        ${!isFirst ? '<div style="position: absolute; top: -8px; left: 50%; transform: translateX(-50%); width: 2px; height: 8px; background: var(--border);"></div>' : ''}
                        ${!isLast ? '<div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); width: 2px; height: 8px; background: var(--border);"></div>' : ''}
                    </div>
                    <div style="flex: 1; padding-left: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span style="font-size: 0.95rem; font-weight: 600; color: ${level.color};">$${level.price.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
                            <span style="font-size: 0.7rem; color: var(--text-muted);">${dist}</span>
                        </div>
                        ${barWidth > 0 ? `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="flex: 1; max-width: 150px; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden;">
                                <div style="width: ${barWidth}%; height: 100%; background: ${barColor}; border-radius: 3px;"></div>
                            </div>
                            <span style="font-size: 0.65rem; color: var(--text-muted);">${gexText}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
    });

    html += `
            </div>
        </div>
    `;

    return html;
}

// =============================================================================
// GEX LEVELS TABLE
// =============================================================================
function renderGexLevelsTable(keyLevels, currentPrice) {
    if (!keyLevels || !Array.isArray(keyLevels) || keyLevels.length === 0 || !currentPrice) {
        return '<div style="text-align: center; color: var(--text-muted); padding: 12px; font-size: 0.7rem;">No key levels data available</div>';
    }

    const sortedLevels = [...keyLevels].sort((a, b) => {
        const distA = Math.abs(a.distance_pct || ((a.strike - currentPrice) / currentPrice * 100));
        const distB = Math.abs(b.distance_pct || ((b.strike - currentPrice) / currentPrice * 100));
        return distA - distB;
    });

    const displayLevels = sortedLevels.slice(0, 10);

    let html = `
        <table style="width: 100%; border-collapse: collapse; font-size: 0.7rem;">
            <thead>
                <tr style="background: var(--bg); border-bottom: 1px solid var(--border);">
                    <th style="padding: 6px 8px; text-align: left; font-weight: 600; color: var(--text-muted);">Strike</th>
                    <th style="padding: 6px 8px; text-align: right; font-weight: 600; color: var(--text-muted);">GEX ($M)</th>
                    <th style="padding: 6px 8px; text-align: center; font-weight: 600; color: var(--text-muted);">Type</th>
                    <th style="padding: 6px 8px; text-align: right; font-weight: 600; color: var(--text-muted);">Distance</th>
                </tr>
            </thead>
            <tbody>
    `;

    displayLevels.forEach((level, idx) => {
        const strike = level.strike || 0;
        const netGex = level.net_gex || 0;
        const gexMillions = level.gex_millions !== undefined ? level.gex_millions : (netGex / 1000000);
        const type = (level.type || 'unknown').toLowerCase();
        const distancePct = level.distance_pct !== undefined ? level.distance_pct : ((strike - currentPrice) / currentPrice * 100);

        const gexColor = gexMillions >= 0 ? 'var(--green)' : 'var(--red)';
        const gexSign = gexMillions >= 0 ? '+' : '';
        const rowBg = idx % 2 === 0 ? 'var(--bg-hover)' : 'transparent';
        const distSign = distancePct >= 0 ? '+' : '';

        html += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid var(--border);">
                <td style="padding: 6px 8px; font-weight: 600; color: var(--text);">$${strike.toLocaleString()}</td>
                <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: ${gexColor};">${gexSign}${gexMillions.toFixed(1)}M</td>
                <td style="padding: 6px 8px; text-align: center; font-size: 0.65rem;">${type}</td>
                <td style="padding: 6px 8px; text-align: right; color: var(--text-muted);">${distSign}${distancePct.toFixed(1)}%</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    return html;
}

// =============================================================================
// TOGGLE GEX LEVELS TABLE
// =============================================================================
function toggleGexLevelsTable() {
    const tableBody = document.getElementById('gex-levels-table-body');
    const toggleIcon = document.getElementById('gex-levels-toggle-icon');
    const header = document.getElementById('gex-levels-table-header');

    if (tableBody.style.display === 'none') {
        tableBody.style.display = 'block';
        toggleIcon.style.transform = 'rotate(90deg)';
        header.style.borderRadius = '6px 6px 0 0';
    } else {
        tableBody.style.display = 'none';
        toggleIcon.style.transform = 'rotate(0deg)';
        header.style.borderRadius = '6px';
    }
}

// =============================================================================
// RATIO SPREAD SCORE
// =============================================================================
// =============================================================================
// MARKET X-RAY - INSTITUTIONAL EDGE SCANNER
// =============================================================================

function fmtNotional(n) {
    if (n == null) return '--';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n/1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (n/1e3).toFixed(0) + 'K';
    return n.toFixed(0);
}

function strengthDots(n, max) {
    let html = '<span class="strength-dots">';
    for (let i = 0; i < max; i++) {
        html += `<span class="strength-dot${i < n ? ' filled' : ''}"></span>`;
    }
    return html + '</span>';
}

function toggleXraySection(id) {
    const body = document.getElementById('xray-content-' + id);
    const toggle = document.getElementById('xray-toggle-' + id);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (toggle) toggle.classList.toggle('open', !isOpen);
}

function syncXrayExpirySelect(expirations) {
    const sel = document.getElementById('xray-expiry-select');
    if (!sel) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let html = '<option value="">Auto (nearest)</option>';
    for (const exp of expirations) {
        const d = typeof exp === 'string' ? exp : exp.date;
        if (d <= todayStr) continue;
        const dt = new Date(d + 'T12:00:00');
        const dte = Math.round((dt - today) / 86400000);
        const label = `${months[dt.getMonth()]} ${dt.getDate()} (${dte}d)`;
        html += `<option value="${d}">${label}</option>`;
    }
    sel.innerHTML = html;
}

function pickScanExpirations(selectEl) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const options = Array.from(selectEl.options)
        .filter(o => o.value)
        .map(o => {
            const dt = new Date(o.value + 'T12:00:00');
            return { date: o.value, dte: Math.round((dt - today) / 86400000) };
        })
        .filter(o => o.dte >= 0);
    if (!options.length) return [];

    const targets = [1, 7, 14, 30, 45];
    const picked = new Map();
    for (const target of targets) {
        let best = null, bestDiff = Infinity;
        for (const o of options) {
            const diff = Math.abs(o.dte - target);
            if (diff < bestDiff) { bestDiff = diff; best = o; }
        }
        if (best && !picked.has(best.date)) picked.set(best.date, best);
    }
    return Array.from(picked.values()).sort((a, b) => a.dte - b.dte);
}

async function loadMarketXray() {
    const ticker = optionsAnalysisTicker;
    if (!ticker) return;

    const btn = document.getElementById('xray-scan-btn');
    const placeholder = document.getElementById('xray-placeholder');
    const badge = document.getElementById('xray-composite-badge');
    const banner = document.getElementById('xray-verdict-banner');

    if (btn) btn.disabled = true;
    if (btn) btn.textContent = 'Scanning...';
    if (placeholder) placeholder.style.display = 'none';

    const tickerEl = document.getElementById('xray-ticker');
    const futuresInfo = getFuturesInfo(ticker);
    if (tickerEl) {
        tickerEl.innerHTML = futuresInfo.isFutures
            ? `${ticker} <span style="font-size:0.6rem;padding:2px 5px;background:var(--orange);color:white;border-radius:3px;">FUT</span>`
            : ticker;
    }

    // Get selected expiration — prefer X-Ray's own selector, fall back to Analysis tab
    const xrayExpirySelect = document.getElementById('xray-expiry-select');
    const xrayExpiry = (xrayExpirySelect && xrayExpirySelect.value) ? xrayExpirySelect.value : '';

    // Determine if multi-DTE scan: when X-Ray selector is on Auto (empty) and we have expirations
    const scanExps = (!xrayExpiry && xrayExpirySelect) ? pickScanExpirations(xrayExpirySelect) : [];
    const isMultiDTE = scanExps.length > 1;

    // For single-DTE, fall back to Analysis tab's expiry if X-Ray has none selected
    const expiry = xrayExpiry || (document.getElementById('oa-expiry-select')?.value || '');

    try {
        const isFutures = ticker.startsWith('/');
        const swingParam = isSwingMode() ? 'swing_mode=true' : '';

        // Helper to build URL for a given expiration
        const buildUrl = (exp) => {
            if (isFutures) {
                const params = [`ticker=${encodeURIComponent(ticker)}`, exp ? `expiration=${exp}` : '', swingParam].filter(Boolean).join('&');
                return `${API_BASE}/options/xray?${params}`;
            } else {
                const params = [exp ? `expiration=${exp}` : '', swingParam].filter(Boolean).join('&');
                return `${API_BASE}/options/xray/${ticker}${params ? '?' + params : ''}`;
            }
        };

        let d; // Best xray data for module rendering
        let allTradeIdeas = [];
        let scannedCount = 0;

        if (isMultiDTE) {
            // Multi-DTE parallel scan
            if (btn) btn.innerHTML = `Scanning <span style="font-variant-numeric:tabular-nums">0/${scanExps.length}</span> DTEs...`;
            const today = new Date(); today.setHours(0, 0, 0, 0);

            const promises = scanExps.map(async (expObj) => {
                const url = buildUrl(expObj.date);
                try {
                    const resp = await fetch(url);
                    const json = await resp.json();
                    scannedCount++;
                    if (btn) btn.innerHTML = `Scanning <span style="font-variant-numeric:tabular-nums">${scannedCount}/${scanExps.length}</span> DTEs... ✓`;
                    if (json.ok && json.data) return { data: json.data, dte: expObj.dte, exp: expObj.date };
                } catch (e) { scannedCount++; if (btn) btn.innerHTML = `Scanning <span style="font-variant-numeric:tabular-nums">${scannedCount}/${scanExps.length}</span> DTEs...`; }
                return null;
            });

            const results = (await Promise.all(promises)).filter(Boolean);
            if (!results.length) throw new Error('All DTE scans failed');

            // Pick best composite for module rendering
            d = results.reduce((best, r) => {
                const score = r.data.composite?.score ?? -999;
                const bestScore = best.data.composite?.score ?? -999;
                return score > bestScore ? r : best;
            }).data;

            // Collect all trade ideas, tag with expiration/DTE
            const confOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            for (const r of results) {
                const ideas = r.data.composite?.trade_ideas || [];
                for (const idea of ideas) {
                    idea._expiration = r.exp;
                    idea._dte = r.dte;
                    allTradeIdeas.push(idea);
                }
            }

            // Deduplicate: same title+type keeps highest confidence
            const dedup = new Map();
            for (const idea of allTradeIdeas) {
                const key = `${idea.title}|${idea.type}`;
                const existing = dedup.get(key);
                if (!existing || (confOrder[idea.confidence] ?? 3) < (confOrder[existing.confidence] ?? 3)) {
                    dedup.set(key, idea);
                }
            }

            // Rank by confidence then type priority
            const typePriority = { breakout: 0, bullish: 1, bearish: 1, value: 2, neutral: 3 };
            allTradeIdeas = Array.from(dedup.values()).sort((a, b) => {
                const ca = confOrder[a.confidence] ?? 3, cb = confOrder[b.confidence] ?? 3;
                if (ca !== cb) return ca - cb;
                return (typePriority[a.type] ?? 4) - (typePriority[b.type] ?? 4);
            }).slice(0, 5);

        } else {
            // Single-DTE scan (existing behavior)
            const url = buildUrl(expiry);
            const response = await fetch(url);
            const json = await response.json();
            if (!json.ok || !json.data) throw new Error(json.error || 'Failed to load X-Ray data');
            d = json.data;
            allTradeIdeas = d.composite?.trade_ideas || [];
        }

        // Store for swing trade tracking
        window._lastXrayData = d;

        // Show banner
        if (banner) banner.style.display = 'block';

        // Render all 6 modules
        renderCompositeScore(d.composite);
        renderDealerFlow(d.dealer_flow);
        renderSqueezePin(d.squeeze_pin);
        renderVolSurface(d.vol_surface);
        renderSmartMoney(d.smart_money);
        renderTradeZones(d.trade_zones);

        // Update badge
        if (d.composite) {
            const score = d.composite.score || 0;
            const label = d.composite.label || 'NEUTRAL';
            badge.textContent = `SCORE: ${score}`;
            const colors = {
                'STRONG BULLISH': {bg:'rgba(34,197,94,0.2)',c:'var(--green)'},
                'BULLISH': {bg:'rgba(59,130,246,0.2)',c:'var(--blue)'},
                'NEUTRAL': {bg:'rgba(251,191,36,0.15)',c:'var(--orange)'},
                'BEARISH': {bg:'rgba(239,68,68,0.15)',c:'var(--red)'},
                'STRONG BEARISH': {bg:'rgba(239,68,68,0.25)',c:'var(--red)'}
            };
            const clr = colors[label] || colors['NEUTRAL'];
            badge.style.background = clr.bg;
            badge.style.color = clr.c;

            // Update verdict banner
            document.getElementById('xray-verdict').textContent = label;
            document.getElementById('xray-verdict').style.color = clr.c;
            document.getElementById('xray-interpretation').textContent = d.composite.interpretation || '';
            banner.style.background = clr.bg;
            banner.style.borderLeft = `4px solid ${clr.c}`;

            // Render trade ideas (multi-DTE uses merged list, single uses original)
            renderTradeIdeas(allTradeIdeas, isMultiDTE ? scanExps.length : 0);
        }

        // Auto-expand composite
        document.getElementById('xray-content-composite').style.display = 'block';
        document.getElementById('xray-toggle-composite').classList.add('open');

        console.log('Market X-Ray loaded for', ticker, isMultiDTE ? `(scanned ${scanExps.length} DTEs)` : '');

    } catch (e) {
        console.error('Market X-Ray error:', e);
        badge.textContent = 'ERROR';
        badge.style.background = 'var(--red-bg)';
        badge.style.color = 'var(--red)';
        if (banner) {
            banner.style.display = 'block';
            document.getElementById('xray-verdict').textContent = 'ERROR';
            document.getElementById('xray-interpretation').textContent = e.message;
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
    }
}

function renderCompositeScore(data) {
    const el = document.getElementById('xray-content-composite');
    if (!el || !data) { if (el) el.innerHTML = '<div style="color:var(--text-muted)">No composite data</div>'; return; }

    const score = data.score || 0;
    const label = data.label || 'NEUTRAL';
    const scoreColor = score >= 75 ? 'var(--green)' : score >= 60 ? 'var(--blue)' : score >= 45 ? 'var(--orange)' : 'var(--red)';

    let factorsHtml = '';
    if (data.factors) {
        data.factors.forEach(f => {
            const pct = Math.round(f.score);
            const barColor = f.score >= 60 ? 'var(--green)' : f.score >= 40 ? 'var(--orange)' : 'var(--red)';
            factorsHtml += `<div class="factor-bar-row">
                <span class="factor-bar-name">${f.name}</span>
                <div class="factor-bar-track"><div class="factor-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
                <span class="factor-bar-value" style="color:${barColor}">${pct}</span>
            </div>`;
        });
    }

    // Day-over-day deltas
    let deltasHtml = '';
    if (data.deltas) {
        const d = data.deltas;
        const chips = [];
        if (d.gex_direction) {
            const gc = d.gex_direction === 'increasing' ? 'var(--green)' : 'var(--red)';
            chips.push(`<span class="delta-chip" style="color:${gc}">GEX ${d.gex_direction}</span>`);
        }
        if (d.iv_direction && d.iv_direction !== 'stable') {
            const ic = d.iv_direction === 'rising' ? 'var(--red)' : 'var(--green)';
            chips.push(`<span class="delta-chip" style="color:${ic}">IV ${d.iv_direction} (${(d.iv_change*100).toFixed(1)}%)</span>`);
        }
        if (d.flow_direction && d.flow_direction !== 'stable') {
            const fc = d.flow_direction.includes('bullish') ? 'var(--green)' : 'var(--red)';
            chips.push(`<span class="delta-chip" style="color:${fc}">Flow ${d.flow_direction}</span>`);
        }
        if (chips.length) {
            deltasHtml = `<div class="deltas-row" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">${chips.join('')}</div>`;
        }
    }

    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
            <div class="score-ring" style="border-color:${scoreColor}">
                <div class="score-number" style="color:${scoreColor}">${score}</div>
                <div class="score-max">/100</div>
            </div>
            <div style="flex:1;min-width:200px;">
                <div style="font-size:0.75rem;font-weight:700;color:${scoreColor};margin-bottom:8px;">${label}</div>
                ${factorsHtml}
            </div>
        </div>
        <div class="interpretation-box" style="margin-top:12px;background:var(--bg-hover);border-radius:6px;padding:10px;font-size:0.75rem;color:var(--text-muted);">
            ${data.interpretation || 'Analyzing...'}
        </div>
        ${deltasHtml}`;
}

function renderDealerFlow(data) {
    const el = document.getElementById('xray-content-dealer');
    if (!el || !data) { if (el) el.innerHTML = '<div style="color:var(--text-muted)">No dealer flow data</div>'; return; }

    const levels = data.levels || [];
    const currentPrice = data.current_price || 0;
    const airPockets = data.air_pockets || [];

    if (!levels.length) { el.innerHTML = '<div style="color:var(--text-muted)">No GEX levels available</div>'; return; }

    const maxAbs = Math.max(...levels.map(l => Math.abs(l.gex_value || 0)), 1);

    let barsHtml = '';
    levels.forEach(l => {
        const price = l.price;
        const gex = l.gex_value || 0;
        const pct = Math.min(100, Math.abs(gex) / maxAbs * 100);
        const isPositive = gex >= 0;
        const isCurrent = Math.abs(price - currentPrice) / currentPrice < 0.003;
        const isAirPocket = airPockets.some(ap => price >= ap.from_price && price <= ap.to_price);

        const barClass = isPositive ? 'flow-bar-positive' : 'flow-bar-negative';
        const airClass = isAirPocket ? ' flow-bar-air-pocket' : '';
        const currentMark = isCurrent ? `<div class="flow-bar-current" style="left:50%"></div>` : '';
        const label = price >= 1000 ? price.toFixed(0) : price.toFixed(1);

        barsHtml += `<div class="flow-bar-container${isCurrent ? ' style="font-weight:700;"' : ''}">
            <span class="flow-bar-label">${isCurrent ? '>' : ''}$${label}</span>
            <div class="flow-bar-track${airClass}">
                <div class="flow-bar ${barClass}" style="width:${pct}%"></div>
                ${currentMark}
            </div>
            <span style="min-width:50px;text-align:right;color:${isPositive ? 'var(--green)' : 'var(--red)'};font-size:0.65rem">${l.regime}</span>
        </div>`;
    });

    const airHtml = airPockets.length > 0
        ? `<div class="xray-badge red" style="margin-top:8px;">AIR POCKETS: ${airPockets.map(a => '$' + a.from_price.toFixed(0) + '-' + a.to_price.toFixed(0)).join(', ')}</div>`
        : '';

    el.innerHTML = `
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:8px;">
            <span class="xray-badge green">GREEN = Stabilizing (dealers dampen moves)</span>
            <span class="xray-badge red">RED = Amplifying (dealers chase moves)</span>
        </div>
        ${barsHtml}
        ${airHtml}`;
}

function renderSqueezePin(data) {
    const el = document.getElementById('xray-content-squeeze');
    if (!el || !data) { if (el) el.innerHTML = '<div style="color:var(--text-muted)">No squeeze/pin data</div>'; return; }

    const sq = data.squeeze_score || 0;
    const pin = data.pin_score || 0;
    const sqColor = sq >= 70 ? 'var(--red)' : sq >= 40 ? 'var(--orange)' : 'var(--green)';
    const pinColor = pin >= 70 ? 'var(--purple)' : pin >= 40 ? 'var(--orange)' : 'var(--text-muted)';
    const sqDir = data.squeeze_direction || '--';
    const sqTrigger = data.squeeze_trigger_price ? '$' + data.squeeze_trigger_price.toFixed(2) : '--';
    const pinStrike = data.pin_strike ? '$' + data.pin_strike.toFixed(2) : '--';

    // SVG gauge
    function gauge(val, color, label, subtitle) {
        const r = 38, cx = 45, cy = 45, circumference = 2 * Math.PI * r;
        const offset = circumference - (val / 100) * circumference;
        return `<div class="gauge-item">
            <div class="gauge-circle" style="width:90px;height:90px;">
                <svg width="90" height="90" style="position:absolute;inset:0;transform:rotate(-90deg)">
                    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
                    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
                        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
                </svg>
                <span class="gauge-value" style="color:${color};z-index:1">${val}</span>
            </div>
            <div class="gauge-label">${label}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">${subtitle}</div>
        </div>`;
    }

    el.innerHTML = `
        <div class="gauge-row">
            ${gauge(sq, sqColor, 'SQUEEZE', sqDir.toUpperCase() + ' @ ' + sqTrigger)}
            ${gauge(pin, pinColor, 'PIN RISK', 'Strike: ' + pinStrike)}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:8px;background:var(--bg-hover);border-radius:6px;">
            ${data.explanation || 'No squeeze or pin conditions detected.'}
        </div>`;
}

function renderVolSurface(data) {
    const el = document.getElementById('xray-content-volsurface');
    if (!el || !data) { if (el) el.innerHTML = '<div style="color:var(--text-muted)">No vol surface data</div>'; return; }

    const skew = data.skew_25d;
    const skewLabel = data.skew_label || '--';
    const termStruct = data.term_structure || '--';
    const termSignal = data.term_signal || '--';

    const skewColor = skewLabel === 'steep' ? 'red' : skewLabel === 'flat' ? 'orange' : 'green';
    const termColor = termSignal === 'inverted' ? 'red' : termSignal === 'neutral' ? 'orange' : 'green';

    function miniTable(title, color, items, headers) {
        if (!items || !items.length) return '';
        let rows = items.map(i => `<tr>
            <td style="color:var(--text)">${i.type ? i.type.toUpperCase() : ''} $${(i.strike||0).toFixed(1)}</td>
            <td>${(i.theta||0).toFixed(4)}</td>
            <td>${(i.gamma||0).toFixed(5)}</td>
            <td style="font-weight:600;color:var(--${color})">${(i.ratio||0).toFixed(1)}</td>
        </tr>`).join('');
        return `<div style="margin-top:10px;">
            <div style="font-size:0.7rem;font-weight:600;color:var(--${color});margin-bottom:4px;">${title}</div>
            <table class="xray-table"><thead><tr><th style="text-align:left">Strike</th><th>Theta</th><th>Gamma</th><th>|T|/G Ratio</th></tr></thead>
            <tbody>${rows}</tbody></table>
        </div>`;
    }

    el.innerHTML = `
        <div style="margin-bottom:10px;">
            <span class="xray-badge ${skewColor}">SKEW: ${skew != null ? (skew*100).toFixed(1) + '%' : '--'} (${skewLabel})</span>
            <span class="xray-badge ${termColor}">TERM: ${termStruct} (${termSignal})</span>
        </div>
        ${miniTable('Cheapest Gamma (Buy These)', 'green', data.cheapest_gamma, ['Strike','Theta','Gamma','Ratio'])}
        ${miniTable('Richest Theta (Sell These)', 'purple', data.richest_theta, ['Strike','Theta','Gamma','Ratio'])}`;
}

function renderSmartMoney(data) {
    const el = document.getElementById('xray-content-smartmoney');
    if (!el || !data) { if (el) el.innerHTML = '<div style="color:var(--text-muted)">No smart money data</div>'; return; }

    const flow = data.net_flow || '--';
    const callN = data.total_call_notional || 0;
    const putN = data.total_put_notional || 0;
    const flowColor = flow === 'bullish' ? 'green' : 'red';

    let signalsHtml = '';
    const fresh = data.fresh_positions || [];
    const walls = data.oi_walls || [];

    if (fresh.length > 0) {
        let rows = fresh.map(f => `<tr>
            <td style="color:var(--text)">${f.type ? f.type.toUpperCase() : ''} $${(f.strike||0).toFixed(1)}</td>
            <td>${(f.volume||0).toLocaleString()}</td>
            <td>${(f.oi||0).toLocaleString()}</td>
            <td style="font-weight:600;color:var(--orange)">${(f.ratio||0).toFixed(1)}x</td>
        </tr>`).join('');
        signalsHtml += `<div style="margin-top:10px;">
            <div style="font-size:0.7rem;font-weight:600;color:var(--orange);margin-bottom:4px;">Fresh Positions (Vol/OI > 2x)</div>
            <table class="xray-table"><thead><tr><th style="text-align:left">Strike</th><th>Volume</th><th>OI</th><th>Ratio</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    if (walls.length > 0) {
        let rows = walls.map(w => `<tr>
            <td style="color:var(--text)">$${(w.strike||0).toFixed(1)}</td>
            <td style="font-weight:600">${(w.total_oi||0).toLocaleString()}</td>
            <td>${(w.avg_neighbor_oi||0).toLocaleString()}</td>
        </tr>`).join('');
        signalsHtml += `<div style="margin-top:10px;">
            <div style="font-size:0.7rem;font-weight:600;color:var(--cyan);margin-bottom:4px;">OI Walls (> 3x Neighbors)</div>
            <table class="xray-table"><thead><tr><th style="text-align:left">Strike</th><th>Total OI</th><th>Avg Neighbor</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    el.innerHTML = `
        <div style="margin-bottom:10px;">
            <span class="xray-badge ${flowColor}" style="font-size:0.8rem;">
                ${flow.toUpperCase()} FLOW: $${fmtNotional(callN)} calls / $${fmtNotional(putN)} puts
            </span>
        </div>
        ${signalsHtml || '<div style="color:var(--text-muted);font-size:0.75rem;">No significant institutional signals detected</div>'}`;
}

function renderTradeZones(data) {
    const el = document.getElementById('xray-content-tradezones');
    if (!el || !data) { if (el) el.innerHTML = '<div style="color:var(--text-muted)">No trade zone data</div>'; return; }

    const cp = data.current_price || 0;
    const vals = [data.lower_2sd, data.lower_1sd, data.support, cp, data.resistance, data.upper_1sd, data.upper_2sd, data.max_pain, data.gamma_flip].filter(v => v && v > 0);
    if (vals.length < 2) { el.innerHTML = '<div style="color:var(--text-muted)">Insufficient data for zone map</div>'; return; }

    const minP = Math.min(...vals) * 0.998;
    const maxP = Math.max(...vals) * 1.002;
    const range = maxP - minP || 1;
    const pctPos = (v) => ((v - minP) / range * 100);
    const mapHeight = 160;
    const topPx = (v) => (100 - pctPos(v)) / 100 * mapHeight;

    // Collect all lines with their positions, then offset overlapping labels
    const lines = [];
    function addLine(val, color, label, isPrice) {
        if (!val || val <= 0) return;
        lines.push({ val, color, label, isPrice, top: topPx(val) });
    }

    addLine(data.support, 'var(--green)', 'SUPPORT', false);
    addLine(data.resistance, 'var(--red)', 'RESISTANCE', false);
    addLine(data.gamma_flip, 'var(--orange)', 'GAMMA FLIP', false);
    addLine(data.max_pain, 'var(--blue)', 'MAX PAIN', false);
    addLine(cp, '#fff', 'CURRENT PRICE', true);

    // Sort by top position (ascending = top of map first)
    lines.sort((a, b) => a.top - b.top);

    // Offset overlapping right-side labels (min 14px apart)
    const labelTops = [];
    for (const ln of lines) {
        let lt = ln.top;
        for (const prev of labelTops) {
            if (Math.abs(lt - prev) < 14) lt = prev + 14;
        }
        ln.labelTop = Math.max(0, Math.min(lt, mapHeight - 10));
        labelTops.push(ln.labelTop);
    }

    let linesHtml = '';
    for (const ln of lines) {
        const pLabel = ln.val >= 1000 ? ln.val.toFixed(0) : ln.val.toFixed(2);
        if (ln.isPrice) {
            linesHtml += `<div class="zone-line zone-line-price" style="top:${ln.top}px"></div>
                <div class="zone-line-label zone-label-price" style="top:${ln.labelTop}px">CURRENT PRICE</div>
                <div class="zone-price-label" style="top:${ln.top}px;color:#fff;font-weight:700">$${pLabel}</div>`;
        } else {
            linesHtml += `<div class="zone-line" style="top:${ln.top}px;background:${ln.color}"></div>
                <div class="zone-line-label" style="top:${ln.labelTop}px;background:${ln.color};color:white">${ln.label}</div>
                <div class="zone-price-label" style="top:${ln.top}px">$${pLabel}</div>`;
        }
    }

    function band(top, bottom, color) {
        if (!top || !bottom || top <= 0 || bottom <= 0) return '';
        const t1 = topPx(Math.max(top, bottom));
        const t2 = topPx(Math.min(top, bottom));
        return `<div class="zone-band" style="top:${t1}px;height:${t2-t1}px;background:${color}"></div>`;
    }

    el.innerHTML = `
        <div class="zone-map">
            ${band(data.upper_2sd, data.lower_2sd, 'rgba(239,68,68,0.08)')}
            ${band(data.upper_1sd, data.lower_1sd, 'rgba(59,130,246,0.12)')}
            ${linesHtml}
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.7rem;color:var(--text-muted);margin-top:8px;">
            <span>Max Pain Pull: ${data.max_pain_pull ? (data.max_pain_pull * 100).toFixed(0) + '%' : '--'}</span>
            ${data.upper_1sd ? '<span>+1&sigma; $' + data.upper_1sd.toFixed(2) + '</span>' : ''}
            ${data.lower_1sd ? '<span>-1&sigma; $' + data.lower_1sd.toFixed(2) + '</span>' : ''}
        </div>`;
}

function _renderPhdIdeaCard(idea, idx) {
    const dirIcons = { bullish: '&#9650;', bearish: '&#9660;', neutral: '&#9644;' };
    const icon = dirIcons[idea.direction] || '&#8226;';
    const stColor = idea.strategy_type === 'short_premium' ? 'var(--green)' : 'var(--cyan)';
    const stLabel = (idea.strategy_type || '').replace(/_/g, ' ').toUpperCase();
    const dirLabel = (idea.direction || 'neutral').toUpperCase();
    const confLabel = (idea.confidence || '').toUpperCase();
    const confCls = idea.confidence || 'low';
    const kellyPct = idea.kelly_pct ?? 0;
    const dte = idea.dte ?? '--';
    const quality = idea.quality_score ?? '--';

    // Legs table
    const legsHtml = (idea.legs || []).map(leg => {
        const actCls = leg.action === 'SELL' ? 'sell' : 'buy';
        const iv_pct = leg.iv ? (leg.iv * 100).toFixed(0) + '%' : '--';
        const oiFmt = leg.oi >= 1000 ? (leg.oi / 1000).toFixed(1) + 'K' : (leg.oi || 0);
        return `<div class="phd-leg-row">
            <span class="phd-leg-action ${actCls}">${leg.action}</span>
            <span class="phd-leg-strike">$${leg.strike?.toFixed(0)} ${leg.option_type}</span>
            <span class="phd-leg-price">@ $${leg.price?.toFixed(2)}</span>
            <span class="phd-leg-greeks">
                <span>&Delta; ${leg.delta?.toFixed(2)}</span>
                <span>&Theta; $${Math.abs(leg.theta || 0).toFixed(2)}</span>
                <span>&Gamma; ${leg.gamma?.toFixed(3)}</span>
                <span>&nu; ${leg.vega?.toFixed(2)}</span>
                <span>IV ${iv_pct}</span>
            </span>
            <span class="phd-leg-oi">OI ${oiFmt}</span>
        </div>`;
    }).join('');

    // Position Greeks
    const pg = idea.position_greeks || {};

    // Risk summary
    const mp = typeof idea.max_profit === 'number' ? '$' + idea.max_profit : idea.max_profit;
    const ml = typeof idea.max_loss === 'number' ? '$' + idea.max_loss : idea.max_loss;
    const np = idea.net_premium >= 0 ? `+$${idea.net_premium.toFixed(2)}` : `-$${Math.abs(idea.net_premium).toFixed(2)}`;
    const rr = idea.risk_reward ? idea.risk_reward.toFixed(1) + ':1' : '--';
    const dteRange = idea.recommended_dte ? `${idea.recommended_dte[0]}-${idea.recommended_dte[1]}d` : '--';

    return `<div class="trade-idea-card phd-idea-card" data-type="${idea.type}" data-idx="${idx}">
        <div class="trade-idea-header">
            ${icon} ${idea.title}
            <span class="phd-type-badge" style="color:${stColor};border-color:${stColor}">${stLabel}</span>
            <span class="phd-dir-badge">${dirLabel}</span>
            <span class="trade-idea-confidence confidence-${confCls}">${confLabel}</span>
            ${kellyPct > 0 ? `<span class="phd-kelly-badge">${kellyPct}% Kelly</span>` : ''}
        </div>
        <div class="phd-legs-table">${legsHtml}</div>
        <div class="phd-risk-summary">
            <span>Net: ${np}</span>
            <span>Max Loss: ${ml}</span>
            <span>Max Profit: ${mp}</span>
            <span>R:R ${rr}</span>
        </div>
        <div class="phd-position-greeks">
            <span>&Delta; ${pg.delta?.toFixed(3) ?? '--'}</span>
            <span>&Theta; $${Math.abs(pg.theta || 0).toFixed(3)}</span>
            <span>&Gamma; ${pg.gamma?.toFixed(4) ?? '--'}</span>
            <span>&nu; ${pg.vega?.toFixed(3) ?? '--'}</span>
            <span class="phd-dte-badge">${dte}d</span>
            <span>Rec: ${dteRange}</span>
            <span class="phd-quality-badge">Q: ${quality}</span>
        </div>
        <div class="trade-idea-row"><span class="trade-idea-label label-if">IF</span><span>${idea.condition}</span></div>
        <div class="trade-idea-rationale">${idea.rationale}</div>
    </div>`;
}

function renderTradeIdeas(ideas, scannedDTEs) {
    const el = document.getElementById('xray-trade-ideas');
    if (!el || !ideas || !ideas.length) { if (el) el.style.display = 'none'; return; }
    window._lastTradeIdeas = ideas;

    const typeIcons = {
        bullish: '&#9650;',
        bearish: '&#9660;',
        neutral: '&#9644;',
        breakout: '&#9733;',
        value: '&#127919;'
    };

    const html = ideas.map((idea, idx) => {
        // PhD Strategy enhanced card
        if (idea.phd_strategy) {
            return _renderPhdIdeaCard(idea, idx);
        }
        const icon = typeIcons[idea.type] || '&#8226;';
        const conf = idea.confidence || '';
        const confBadge = conf ? `<span class="trade-idea-confidence confidence-${conf}">${conf.toUpperCase()}</span>` : '';
        const swingBadge = idea.swing_mode ? '<span class="swing-badge">SWING</span>' : '';
        const dteBadge = idea._dte != null ? `<span class="dte-badge">${idea._dte}d</span>` : '';
        const swingClass = idea.swing_mode ? ' swing-idea' : '';
        // Parse action for track button
        const hasAction = idea.action && idea.action.includes('Buy $');
        const trackBtn = hasAction ? `<button class="trade-idea-track-btn" onclick="trackTradeIdea(${idx})">Track</button>` : '';
        // Swing metrics row
        let swingMetrics = '';
        if (idea.swing_mode && idea.swing_metrics) {
            const sm = idea.swing_metrics;
            const parts = [];
            if (sm.edge_score) parts.push(`<span class="swing-metric"><span class="swing-metric-label">Edge</span><strong>${sm.edge_score}</strong></span>`);
            if (sm.dte) parts.push(`<span class="swing-metric"><span class="swing-metric-label">DTE</span>${sm.dte}d</span>`);
            if (sm.theta_per_day) parts.push(`<span class="swing-metric"><span class="swing-metric-label">θ/day</span>$${sm.theta_per_day}</span>`);
            if (sm.days_of_theta) parts.push(`<span class="swing-metric"><span class="swing-metric-label">θ runway</span>${sm.days_of_theta}d</span>`);
            if (sm.optimal_exit_dte) parts.push(`<span class="swing-metric"><span class="swing-metric-label">Exit by</span>${sm.optimal_exit_dte}d</span>`);
            if (sm.iv_rank) parts.push(`<span class="swing-metric"><span class="swing-metric-label">IV</span>${sm.iv_rank}</span>`);
            if (parts.length) swingMetrics = `<div class="swing-metrics-row">${parts.join('')}</div>`;
            // Edge breakdown mini-bar
            if (sm.edge_breakdown) {
                const eb = sm.edge_breakdown;
                const bars = [
                    {label: 'IV Disc', val: eb.iv_discount, color: 'var(--cyan)'},
                    {label: 'Sig Gap', val: eb.signal_gap, color: 'var(--blue)'},
                    {label: 'θ Eff', val: eb.theta_eff, color: 'var(--green)'},
                    {label: 'Flow', val: eb.flow, color: 'var(--orange)'},
                    {label: 'GEX', val: eb.gex_catalyst, color: 'var(--purple)'}
                ];
                const barHtml = bars.map(b =>
                    `<div class="edge-bar-item"><span class="edge-bar-label">${b.label}</span><div class="edge-bar-track"><div class="edge-bar-fill" style="width:${b.val}%;background:${b.color}"></div></div><span class="edge-bar-val">${b.val}</span></div>`
                ).join('');
                swingMetrics += `<div class="edge-breakdown">${barHtml}</div>`;
            }
        }
        return `<div class="trade-idea-card${swingClass}" data-type="${idea.type}" data-idx="${idx}">
            <div class="trade-idea-header">${icon} ${idea.title} ${dteBadge} ${swingBadge} ${confBadge} ${trackBtn}</div>
            <div class="trade-idea-row"><span class="trade-idea-label label-if">IF</span><span>${idea.condition}</span></div>
            <div class="trade-idea-row"><span class="trade-idea-label label-action">&rarr;</span><span>${idea.action}</span></div>
            <div class="trade-idea-row"><span class="trade-idea-label label-tp">TP</span><span>${idea.target}</span></div>
            <div class="trade-idea-row"><span class="trade-idea-label label-sl">SL</span><span>${idea.stop}</span></div>
            <div class="trade-idea-rationale">${idea.rationale}</div>
            ${swingMetrics}
        </div>`;
    }).join('');

    const titleSuffix = scannedDTEs ? ` <span style="font-size:0.65rem;color:var(--text-muted)">(Best across ${scannedDTEs} DTEs)</span>` : '';
    el.innerHTML = `<div class="trade-ideas-title">TRADE IDEAS${titleSuffix}</div>${html}`;
    el.style.display = 'block';
}

// =============================================================================
// OPTIONS VISUALIZATION
// =============================================================================
async function loadOptionsViz(ticker) {
    if (!ticker) {
        ticker = optionsAnalysisTicker;
    }
    if (!ticker) {
        console.warn('loadOptionsViz: No ticker provided');
        return;
    }

    const container = document.getElementById('options-viz-container');
    const priceChartContainer = document.getElementById('price-chart-container');
    const gexChartContainer = document.getElementById('gex-chart-container');

    container.style.display = 'block';

    const tickerLabel = document.getElementById('viz-ticker-label');
    if (tickerLabel) {
        tickerLabel.textContent = `- ${ticker}`;
    }

    if (priceChartContainer) {
        priceChartContainer.innerHTML = '<div class="chart-loading"><span class="loading-spinner"></span> Loading price data...</div>';
    }
    if (gexChartContainer) {
        gexChartContainer.innerHTML = '<div class="chart-loading"><span class="loading-spinner"></span> Loading GEX data...</div>';
    }

    try {
        const isFutures = ticker.startsWith('/');
        const tickerParam = encodeURIComponent(ticker);
        const expiry = document.getElementById('oa-expiry-select')?.value || '';
        const days = parseInt(document.getElementById('viz-timeframe')?.value) || 30;

        const gexLevelsUrl = isFutures
            ? `${API_BASE}/options/gex-levels?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/gex-levels/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        const gexUrl = isFutures
            ? `${API_BASE}/options/gex?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/gex/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        const maxPainUrl = isFutures
            ? `${API_BASE}/options/max-pain?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/max-pain/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        const effectiveDays = INTERVAL_DAYS_MAP[selectedInterval] || days;
        const candlesUrl = `${API_BASE}/market/candles?ticker=${tickerParam}&days=${effectiveDays}&interval=${selectedInterval}`;
        const volumeProfileUrl = isFutures ? null : `${API_BASE}/volume-profile/${ticker}?days=30`;
        const spyCandlesUrl = (!isFutures && ticker.toUpperCase() !== 'SPY')
            ? `${API_BASE}/market/candles?ticker=SPY&days=${effectiveDays}&interval=${selectedInterval}`
            : null;

        // Use cached responses from loadOptionsForExpiry/loadGexDashboard if available
        const cachedGexLevels = getCachedApiResponse(gexLevelsUrl);
        const cachedGex = getCachedApiResponse(gexUrl);
        const cachedMaxPain = getCachedApiResponse(maxPainUrl);

        const [gexLevelsRes, gexRes, maxPainRes, candlesRes, vpRes, spyCandlesRes] = await Promise.all([
            cachedGexLevels ? Promise.resolve(null) : fetch(gexLevelsUrl),
            cachedGex ? Promise.resolve(null) : fetch(gexUrl),
            cachedMaxPain ? Promise.resolve(null) : fetch(maxPainUrl),
            fetch(candlesUrl).catch(e => null),
            volumeProfileUrl ? fetch(volumeProfileUrl).catch(e => null) : Promise.resolve(null),
            spyCandlesUrl ? fetch(spyCandlesUrl).catch(e => null) : Promise.resolve(null)
        ]);

        let gexLevelsData, gexData, maxPainData;
        if (cachedGexLevels) {
            gexLevelsData = cachedGexLevels;
        } else {
            if (!gexLevelsRes.ok) throw new Error(`GEX Levels API error: ${gexLevelsRes.status}`);
            gexLevelsData = await gexLevelsRes.json();
            cacheApiResponse(gexLevelsUrl, gexLevelsData);
        }
        if (cachedGex) {
            gexData = cachedGex;
        } else {
            if (!gexRes.ok) throw new Error(`GEX API error: ${gexRes.status}`);
            gexData = await gexRes.json();
            cacheApiResponse(gexUrl, gexData);
        }
        if (cachedMaxPain) {
            maxPainData = cachedMaxPain;
        } else {
            if (!maxPainRes.ok) throw new Error(`Max Pain API error: ${maxPainRes.status}`);
            maxPainData = await maxPainRes.json();
            cacheApiResponse(maxPainUrl, maxPainData);
        }

        // Parse candles
        if (candlesRes && candlesRes.ok) {
            try {
                const candlesData = await candlesRes.json();
                let candles = [];
                if (candlesData && candlesData.data && Array.isArray(candlesData.data.candles)) {
                    candles = candlesData.data.candles;
                } else if (candlesData && Array.isArray(candlesData.candles)) {
                    candles = candlesData.candles;
                } else if (Array.isArray(candlesData)) {
                    candles = candlesData;
                }
                const isDaily = selectedInterval === '1d' || selectedInterval === '1w';
                optionsVizData.candles = candles.map(c => {
                    let t = c.time || c.date || c.t;
                    // For daily/weekly, convert unix timestamp to YYYY-MM-DD string
                    if (isDaily && typeof t === 'number') {
                        const d = new Date(t * 1000);
                        t = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
                    }
                    return {
                        time: t,
                        open: c.open || c.o,
                        high: c.high || c.h,
                        low: c.low || c.l,
                        close: c.close || c.c,
                        volume: c.volume || c.v || 0
                    };
                }).filter(c => c.time && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
                .filter(c => c.low >= c.open * 0.5 && c.high <= c.open * 2);
            } catch (e) {
                console.error('Error parsing candle data:', e);
                optionsVizData.candles = [];
            }
        } else {
            optionsVizData.candles = [];
        }

        // Parse SPY candles for RS calculation
        optionsVizData.spyCandles = [];
        if (spyCandlesRes && spyCandlesRes.ok) {
            try {
                const spyData = await spyCandlesRes.json();
                let spyCandles = [];
                if (spyData && spyData.data && Array.isArray(spyData.data.candles)) {
                    spyCandles = spyData.data.candles;
                } else if (spyData && Array.isArray(spyData.candles)) {
                    spyCandles = spyData.candles;
                } else if (Array.isArray(spyData)) {
                    spyCandles = spyData;
                }
                const isDaily = selectedInterval === '1d' || selectedInterval === '1w';
                optionsVizData.spyCandles = spyCandles.map(c => {
                    let t = c.time || c.date || c.t;
                    if (isDaily && typeof t === 'number') {
                        const d = new Date(t * 1000);
                        t = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
                    }
                    return {
                        time: t,
                        open: c.open || c.o,
                        high: c.high || c.h,
                        low: c.low || c.l,
                        close: c.close || c.c,
                        volume: c.volume || c.v || 0
                    };
                }).filter(c => c.time && c.close > 0);
            } catch (e) {
                console.error('Error parsing SPY candle data:', e);
            }
        }

        // Parse volume profile (skip for futures - no relevant VP data from backend)
        if (vpRes && vpRes.ok) {
            try {
                const vpData = await vpRes.json();
                if (vpData.ok && vpData.data) {
                    optionsVizData.val = vpData.data.val || 0;
                    optionsVizData.poc = vpData.data.poc || 0;
                    optionsVizData.vah = vpData.data.vah || 0;
                }
            } catch (e) {
                console.warn('Error parsing volume profile:', e);
            }
        } else {
            // For futures (or when backend VP fails), compute from candle data
            if (optionsVizData.candles && optionsVizData.candles.length > 5) {
                const vpComputed = computeVolumeProfile(optionsVizData.candles);
                if (vpComputed) {
                    optionsVizData.poc = vpComputed.bins[vpComputed.pocIndex]?.price || 0;
                    optionsVizData.val = vpComputed.bins[vpComputed.valIndex]?.price || 0;
                    optionsVizData.vah = vpComputed.bins[vpComputed.vahIndex]?.price || 0;
                }
            } else {
                optionsVizData.val = 0;
                optionsVizData.poc = 0;
                optionsVizData.vah = 0;
            }
        }

        // Extract levels
        const levels = gexLevelsData.data || {};
        optionsVizData.currentPrice = levels.current_price || gexData.data?.current_price || 0;
        optionsVizData.callWall = levels.call_wall || 0;
        optionsVizData.putWall = levels.put_wall || 0;
        optionsVizData.gammaFlip = levels.gamma_flip || 0;

        // Extract GEX by strike
        const gex = gexData.data || {};
        optionsVizData.gexByStrike = (gex.gex_by_strike || [])
            .filter(s => s.strike != null && !isNaN(s.strike) && s.strike > 0)
            .map(s => ({
                strike: s.strike,
                callGex: s.call_gex || 0,
                putGex: s.put_gex || 0,
                netGex: s.net_gex || 0,
                callOI: s.call_oi || 0,
                putOI: s.put_oi || 0
            }));

        optionsVizData.totalGex = gex.total_gex || 0;
        const totalCallOI = gex.total_call_oi || 0;
        const totalPutOI = gex.total_put_oi || 0;
        optionsVizData.pcRatio = totalCallOI > 0 ? (totalPutOI / totalCallOI) : 0;

        // Max pain
        const maxPain = maxPainData.data || {};
        optionsVizData.maxPain = maxPain.max_pain_price || maxPain.max_pain || 0;

        // Expected move
        if (levels.expected_move) {
            optionsVizData.expectedMove = {
                upper: levels.expected_move.upper || optionsVizData.currentPrice * 1.02,
                lower: levels.expected_move.lower || optionsVizData.currentPrice * 0.98
            };
        } else {
            optionsVizData.expectedMove = {
                upper: optionsVizData.currentPrice * 1.02,
                lower: optionsVizData.currentPrice * 0.98
            };
        }

        // Update info bar
        updateVizInfoBar();

        // Render charts
        renderPriceChart();
        renderVizGexChart();

        // Update GEX table
        updateGexTable();

        console.log('Options Viz loaded for', ticker);

        // Fetch intelligence overlays (non-blocking, parallel)
        fetchIntelligenceOverlays(ticker);

    } catch (e) {
        console.error('loadOptionsViz error:', e);
        const errorMsg = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--red);">Error: ${e.message}</div>`;
        if (priceChartContainer) priceChartContainer.innerHTML = errorMsg;
        if (gexChartContainer) gexChartContainer.innerHTML = errorMsg;
    }
}

// =============================================================================
// UPDATE VIZ INFO BAR
// =============================================================================
function updateVizInfoBar() {
    const currentPriceEl = document.getElementById('viz-current-price');
    const totalGexEl = document.getElementById('viz-total-gex');
    const maxPainEl = document.getElementById('viz-max-pain');
    const callWallEl = document.getElementById('viz-call-wall');
    const putWallEl = document.getElementById('viz-put-wall');

    if (currentPriceEl) {
        currentPriceEl.textContent = optionsVizData.currentPrice > 0
            ? `$${optionsVizData.currentPrice.toFixed(2)}`
            : '--';
    }

    if (totalGexEl) {
        const gex = optionsVizData.totalGex;
        const gexDisplay = Math.abs(gex) >= 1e9 ? `$${(gex / 1e9).toFixed(1)}B` :
                          Math.abs(gex) >= 1e6 ? `$${(gex / 1e6).toFixed(1)}M` :
                          Math.abs(gex) >= 1e3 ? `$${(gex / 1e3).toFixed(0)}K` :
                          `$${gex.toFixed(0)}`;
        totalGexEl.textContent = gexDisplay;
        totalGexEl.style.color = gex > 0 ? 'var(--green)' : gex < 0 ? 'var(--red)' : 'var(--text)';
    }

    if (maxPainEl) {
        maxPainEl.textContent = optionsVizData.maxPain > 0
            ? `$${optionsVizData.maxPain.toFixed(0)}`
            : '--';
    }

    if (callWallEl) {
        callWallEl.textContent = optionsVizData.callWall > 0
            ? `$${optionsVizData.callWall.toFixed(0)}`
            : '--';
    }

    if (putWallEl) {
        putWallEl.textContent = optionsVizData.putWall > 0
            ? `$${optionsVizData.putWall.toFixed(0)}`
            : '--';
    }
}

// =============================================================================
// RENDER PRICE CHART
// =============================================================================
function renderPriceChart() {
    const container = document.getElementById('price-chart-container');

    if (!container) {
        console.warn('renderPriceChart: price-chart-container not found');
        return;
    }

    // Skip rendering if container is hidden (0 dimensions) — will re-render on tab switch
    if (container.clientWidth === 0) {
        return;
    }

    if (priceChart) {
        priceChart.remove();
        priceChart = null;
        priceSeries = null;
        volumeSeries = null;
        indicatorSeries = {};
        priceLines = {};
    }
    vpProfileData = null;
    vpLastRangeKey = null;
    removeVolumeProfileOverlay();
    // Remove floating overlay badges
    const oldRegime = container.querySelector('.chart-regime-badge');
    if (oldRegime) oldRegime.remove();
    const oldDealer = container.querySelector('.chart-dealer-badge');
    if (oldDealer) oldDealer.remove();
    const oldOhlc = document.getElementById('ohlc-legend');
    if (oldOhlc) oldOhlc.remove();

    if (!optionsVizData.candles || optionsVizData.candles.length === 0) {
        // Create a synthetic candle from current price so chart can render and live updates work
        if (optionsVizData.currentPrice > 0) {
            const nyNow = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/New_York'}));
            const isDaily = selectedInterval === '1d' || selectedInterval === '1w';
            const p = optionsVizData.currentPrice;
            const t = isDaily
                ? nyNow.getFullYear() + '-' + String(nyNow.getMonth() + 1).padStart(2, '0') + '-' + String(nyNow.getDate()).padStart(2, '0')
                : Math.floor(Date.now() / 1000);
            optionsVizData.candles = [{
                time: t,
                open: p, high: p, low: p, close: p, volume: 0
            }];
        } else {
            container.innerHTML = '<div class="chart-loading">No price data available</div>';
            return;
        }
    }

    container.innerHTML = '';

    // TradingView-style OHLC crosshair legend (upper-left)
    const ohlcLegend = document.createElement('div');
    ohlcLegend.id = 'ohlc-legend';
    ohlcLegend.style.cssText = 'position:absolute;top:6px;left:6px;z-index:10;font-size:11px;color:#9ca3af;pointer-events:none;line-height:1.6;letter-spacing:0.01em;';
    container.style.position = 'relative';
    container.appendChild(ohlcLegend);
    // Show ticker + interval as static first line
    const tkLabel = (optionsAnalysisTicker || '').toUpperCase();
    const intLabel = (selectedInterval || '1d').toUpperCase();
    ohlcLegend.innerHTML = `<span style="color:#d1d5db;font-weight:700;font-size:13px;">${tkLabel}</span> <span style="color:#6b7280;font-size:10px;">${intLabel}</span>`;

    priceChart = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.05)' },
            horzLines: { color: 'rgba(255,255,255,0.05)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: 'rgba(224, 227, 235, 0.4)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: '#363A45',
            },
            horzLine: {
                color: 'rgba(224, 227, 235, 0.4)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: '#363A45',
            },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', autoScale: isAutoScale, mode: isLogScale ? 1 : 0, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: selectedInterval !== '1d' && selectedInterval !== '1w' },
        width: container.clientWidth,
        height: container.clientHeight || 300,
    });

    priceSeries = priceChart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
    });

    priceSeries.setData(optionsVizData.candles);

    // Volume histogram
    if (document.getElementById('viz-toggle-volume')?.checked) {
        addVolumeSeries();
    }

    updatePriceChartLevels();
    updateIndicators();

    // Volume Profile overlay — render after LW charts layout settles
    if (document.getElementById('viz-toggle-vp')?.checked) {
        setTimeout(renderVolumeProfileOverlay, 50);
    }

    // RSI chart if enabled
    if (document.getElementById('viz-toggle-rsi')?.checked) {
        renderRsiChart();
        document.getElementById('rsi-chart-container').style.display = 'block';
    }

    // RS chart if enabled
    if (document.getElementById('viz-toggle-rs')?.checked) {
        renderRsChart();
        document.getElementById('rs-chart-container').style.display = 'block';
    }

    // Disable RS toggle for futures/SPY
    var rsToggle = document.getElementById('viz-toggle-rs');
    var rsLabel = rsToggle ? rsToggle.closest('.toggle-item') : null;
    var currentTk = optionsAnalysisTicker;
    if (rsToggle && rsLabel) {
        if (currentTk && (currentTk.startsWith('/') || currentTk.toUpperCase() === 'SPY')) {
            rsToggle.checked = false;
            rsLabel.style.opacity = '0.4';
            rsLabel.style.pointerEvents = 'none';
            var rsContainer = document.getElementById('rs-chart-container');
            if (rsContainer) rsContainer.style.display = 'none';
            if (rsChart) {
                try { rsChart.remove(); } catch(e) {}
                rsChart = null; rsSeries = null; rsSmaSeries = null;
            }
        } else {
            rsLabel.style.opacity = '1';
            rsLabel.style.pointerEvents = 'auto';
        }
    }

    // COT toggle: enable for futures, disable for equities (inverse of RS)
    var cotToggle = document.getElementById('viz-toggle-cot');
    var cotLabel = cotToggle ? cotToggle.closest('.toggle-item') : null;
    if (cotToggle && cotLabel) {
        if (currentTk && currentTk.startsWith('/')) {
            cotLabel.style.opacity = '1';
            cotLabel.style.pointerEvents = 'auto';
            if (cotToggle.checked) {
                fetchAndRenderCotChart(currentTk);
                document.getElementById('cot-chart-container').style.display = 'block';
            }
        } else {
            cotToggle.checked = false;
            cotLabel.style.opacity = '0.4';
            cotLabel.style.pointerEvents = 'none';
            var cotContainer = document.getElementById('cot-chart-container');
            if (cotContainer) cotContainer.style.display = 'none';
            if (cotChart) {
                try { cotChart.remove(); } catch(e) {}
                cotChart = null; cotCat1Series = null; cotCat2Series = null; cotCat3Series = null; cotData = null;
            }
        }
    }

    priceChart.timeScale().fitContent();

    // Prevent page scroll when mouse wheel is used over chart (enables TradingView-style scroll-to-zoom)
    container.addEventListener('wheel', function(e) { e.preventDefault(); }, { passive: false });

    // Redraw VP overlay on scroll/zoom (debounced)
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        if (document.getElementById('viz-toggle-vp')?.checked) {
            vpDebouncedRedraw();
        }
    });

    // TradingView-style OHLC crosshair: ticker line + OHLC line
    const _ohlcTkLine = `<span style="color:#d1d5db;font-weight:700;font-size:13px;">${tkLabel}</span> <span style="color:#6b7280;font-size:10px;">${intLabel}</span>`;
    let _ohlcRafPending = false;
    let _ohlcLastTime = null;
    priceChart.subscribeCrosshairMove(param => {
        if (!ohlcLegend) return;
        if (!param || !param.time || !param.seriesPrices) {
            ohlcLegend.innerHTML = _ohlcTkLine;
            _ohlcLastTime = null;
            return;
        }
        if (param.time === _ohlcLastTime) return;
        if (_ohlcRafPending) return;
        _ohlcRafPending = true;
        requestAnimationFrame(() => {
            _ohlcRafPending = false;
            _ohlcLastTime = param.time;
            const candle = param.seriesPrices.get(priceSeries);
            if (!candle || candle.close === undefined) {
                ohlcLegend.innerHTML = _ohlcTkLine;
                return;
            }
            const o = candle.open, h = candle.high, l = candle.low, c = candle.close;
            const chg = o !== 0 ? ((c - o) / o * 100) : 0;
            const up = c >= o;
            const clr = up ? '#26a69a' : '#ef5350';
            const sign = chg >= 0 ? '+' : '';
            const fmt = v => v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
            const vol = param.seriesPrices.get(volumeSeries);
            const volStr = vol !== undefined && vol !== null
                ? ` <span style="color:#6b7280;">V</span> <span style="color:#9ca3af;">${Number(typeof vol === 'object' ? vol.value || 0 : vol).toLocaleString()}</span>`
                : '';
            ohlcLegend.innerHTML = _ohlcTkLine +
                `<br><span style="color:#6b7280;">O</span> <span style="color:${clr};">${fmt(o)}</span>` +
                ` <span style="color:#6b7280;">H</span> <span style="color:${clr};">${fmt(h)}</span>` +
                ` <span style="color:#6b7280;">L</span> <span style="color:${clr};">${fmt(l)}</span>` +
                ` <span style="color:#6b7280;">C</span> <span style="color:${clr};">${fmt(c)}</span>` +
                ` <span style="color:${clr};font-weight:600;">${sign}${chg.toFixed(2)}%</span>` +
                volStr;
        });
    });

    let _chartLastW = container.clientWidth, _chartLastH = container.clientHeight;
    const resizeObserver = new ResizeObserver(entries => {
        if (priceChart && container.clientWidth > 0) {
            const newW = container.clientWidth, newH = container.clientHeight || 300;
            if (Math.abs(newW - _chartLastW) > 5 || Math.abs(newH - _chartLastH) > 5) {
                _chartLastW = newW;
                _chartLastH = newH;
                priceChart.applyOptions({ width: newW, height: newH });
                vpDebouncedRedraw();
            }
        }
    });
    resizeObserver.observe(container);

    startLivePriceUpdates();
    applyScaleButtons();

    // Render intelligence overlay badges (if data already loaded)
    renderRegimeBadge();
    renderDealerBadge();
    renderVrpGauge();
    renderFlowStrip();
}

// =============================================================================
// UPDATE PRICE CHART LEVELS
// =============================================================================
function updatePriceChartLevels() {
    if (!priceSeries) {
        console.warn('updatePriceChartLevels: priceSeries not available');
        return;
    }

    Object.values(priceLines).forEach(line => {
        if (line) {
            try {
                priceSeries.removePriceLine(line);
            } catch (e) {}
        }
    });
    priceLines = {};

    // Call Wall (red)
    if (document.getElementById('viz-toggle-callwall')?.checked && optionsVizData.callWall > 0) {
        priceLines.callWall = priceSeries.createPriceLine({
            price: optionsVizData.callWall,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Call Wall',
        });
    }

    // Put Wall (green)
    if (document.getElementById('viz-toggle-putwall')?.checked && optionsVizData.putWall > 0) {
        priceLines.putWall = priceSeries.createPriceLine({
            price: optionsVizData.putWall,
            color: '#22c55e',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Put Wall',
        });
    }

    // Gamma Flip (orange)
    if (document.getElementById('viz-toggle-gammaflip')?.checked && optionsVizData.gammaFlip > 0) {
        priceLines.gammaFlip = priceSeries.createPriceLine({
            price: optionsVizData.gammaFlip,
            color: '#f97316',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'Gamma Flip',
        });
    }

    // Max Pain (purple)
    if (document.getElementById('viz-toggle-maxpain')?.checked && optionsVizData.maxPain > 0) {
        priceLines.maxPain = priceSeries.createPriceLine({
            price: optionsVizData.maxPain,
            color: '#a855f7',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'Max Pain',
        });
    }

    // VAL (cyan)
    if (document.getElementById('viz-toggle-val')?.checked && optionsVizData.val > 0) {
        priceLines.val = priceSeries.createPriceLine({
            price: optionsVizData.val,
            color: '#06b6d4',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'VAL',
        });
    }

    // POC (magenta)
    if (document.getElementById('viz-toggle-poc')?.checked && optionsVizData.poc > 0) {
        priceLines.poc = priceSeries.createPriceLine({
            price: optionsVizData.poc,
            color: '#d946ef',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Solid,
            axisLabelVisible: true,
            title: 'POC',
        });
    }

    // VAH (cyan)
    if (document.getElementById('viz-toggle-vah')?.checked && optionsVizData.vah > 0) {
        priceLines.vah = priceSeries.createPriceLine({
            price: optionsVizData.vah,
            color: '#06b6d4',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'VAH',
        });
    }

    // Expected Move Envelope (amber dashed)
    const emData = optionsVizData.expectedMoveData;
    if (document.getElementById('viz-toggle-em')?.checked && emData) {
        if (emData.upper_expected > 0) {
            priceLines.emUpper = priceSeries.createPriceLine({
                price: emData.upper_expected,
                color: '#f59e0b',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.LargeDashed,
                axisLabelVisible: true,
                title: 'EM+',
            });
        }
        if (emData.lower_expected > 0) {
            priceLines.emLower = priceSeries.createPriceLine({
                price: emData.lower_expected,
                color: '#f59e0b',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.LargeDashed,
                axisLabelVisible: true,
                title: 'EM-',
            });
        }
    }

    // GEX Heatmap — top 5 strikes by |net_gex|
    if (document.getElementById('viz-toggle-gexheat')?.checked && optionsVizData.gexByStrike.length > 0) {
        const sorted = [...optionsVizData.gexByStrike].sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex));
        const topStrikes = sorted.slice(0, 5);
        const maxGex = Math.abs(topStrikes[0]?.netGex) || 1;
        topStrikes.forEach((s, i) => {
            const isPositive = s.netGex >= 0;
            const magnitude = Math.abs(s.netGex) / maxGex;
            const alpha = 0.3 + magnitude * 0.5;
            const color = isPositive
                ? `rgba(34, 197, 94, ${alpha.toFixed(2)})`
                : `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
            const lw = magnitude > 0.7 ? 3 : magnitude > 0.3 ? 2 : 1;
            priceLines['gexHeat' + i] = priceSeries.createPriceLine({
                price: s.strike,
                color: color,
                lineWidth: lw,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                axisLabelVisible: false,
                title: '',
            });
        });
    }
}

// =============================================================================
// INTELLIGENCE OVERLAYS
// =============================================================================

async function fetchIntelligenceOverlays(ticker) {
    if (!ticker) return;
    const tickerParam = encodeURIComponent(ticker);
    const isFutures = ticker.startsWith('/');

    // Build URLs — use query param style for futures, path style for equities
    const emUrl = isFutures
        ? `${API_BASE}/options/expected-move?ticker=${tickerParam}`
        : `${API_BASE}/options/expected-move/${ticker}`;
    const regimeUrl = isFutures
        ? `${API_BASE}/options/gex-regime?ticker=${tickerParam}`
        : `${API_BASE}/options/gex-regime/${ticker}`;
    const vrpUrl = isFutures
        ? `${API_BASE}/options/vrp?ticker=${tickerParam}`
        : `${API_BASE}/options/vrp/${ticker}`;
    const vcUrl = isFutures
        ? `${API_BASE}/options/vanna-charm?ticker=${tickerParam}`
        : `${API_BASE}/options/vanna-charm/${ticker}`;

    const results = await Promise.allSettled([
        fetch(emUrl).then(r => r.ok ? r.json() : null),
        fetch(regimeUrl).then(r => r.ok ? r.json() : null),
        fetch(vrpUrl).then(r => r.ok ? r.json() : null),
        fetch(vcUrl).then(r => r.ok ? r.json() : null)
    ]);

    const [emResult, regimeResult, vrpResult, vcResult] = results;

    // Store expected move data
    if (emResult.status === 'fulfilled' && emResult.value) {
        const d = emResult.value.data || emResult.value;
        optionsVizData.expectedMoveData = d;
    }

    // Store GEX regime data
    if (regimeResult.status === 'fulfilled' && regimeResult.value) {
        const d = regimeResult.value.data || regimeResult.value;
        optionsVizData.gexRegime = d;
    }

    // Store VRP data
    if (vrpResult.status === 'fulfilled' && vrpResult.value) {
        const d = vrpResult.value.data || vrpResult.value;
        optionsVizData.vrpData = d;
    }

    // Store vanna-charm data (includes flow_toxicity)
    if (vcResult.status === 'fulfilled' && vcResult.value) {
        const d = vcResult.value.data || vcResult.value;
        optionsVizData.vannaCharmData = d;
    }

    // Re-render overlays with new data
    updatePriceChartLevels();
    renderRegimeBadge();
    renderDealerBadge();
    renderVrpGauge();
    renderFlowStrip();
    saveToggles();
}

// Overlay 2: GEX Regime Badge
function renderRegimeBadge() {
    const container = document.getElementById('price-chart-container');
    if (!container) return;
    // Ensure container is position:relative for absolute children
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }
    // Remove old badge
    const old = container.querySelector('.chart-regime-badge');
    if (old) old.remove();

    const data = optionsVizData.gexRegime;
    if (!data || !document.getElementById('viz-toggle-regime')?.checked) return;

    const regime = (data.regime || '').toLowerCase();
    const confidence = data.confidence != null ? Math.round(data.confidence) : '';
    const rec = data.recommendation || '';
    const emoji = regime === 'pinned' ? '\uD83D\uDCCC' : regime === 'volatile' ? '\u26A1' : '\uD83D\uDD04';
    const cls = regime === 'pinned' ? 'pinned' : regime === 'volatile' ? 'volatile' : 'transitional';

    const badge = document.createElement('div');
    badge.className = `chart-regime-badge ${cls}`;
    badge.innerHTML = `<div>${emoji} <b>${(data.regime || 'Unknown').toUpperCase()}</b>${confidence ? ` ${confidence}%` : ''}</div>`
        + (rec ? `<div style="font-size:0.62rem;opacity:0.85;margin-top:2px;">${rec}</div>` : '');
    container.appendChild(badge);
}

function toggleRegimeBadge() {
    saveToggles();
    renderRegimeBadge();
}

// Overlay 6: Dealer Flow Badge
function renderDealerBadge() {
    const container = document.getElementById('price-chart-container');
    if (!container) return;
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }
    const old = container.querySelector('.chart-dealer-badge');
    if (old) old.remove();

    const data = optionsVizData.vannaCharmData;
    if (!data || !document.getElementById('viz-toggle-dealer')?.checked) return;

    const flow = data.dealer_flow_forecast || data;
    const direction = (flow.direction || '').toLowerCase();
    const magnitude = flow.magnitude || '';
    const netFlow = flow.net_flow_billions;
    const driver = flow.dominant_driver || '';
    const arrow = direction.includes('buy') || direction === 'net_buying' ? '\u2B06' : direction.includes('sell') || direction === 'net_selling' ? '\u2B07' : '\u2194';
    const cls = direction.includes('buy') || direction === 'net_buying' ? 'buying' : direction.includes('sell') || direction === 'net_selling' ? 'selling' : 'neutral';
    const dirLabel = direction.includes('buy') || direction === 'net_buying' ? 'Dealers BUY' : direction.includes('sell') || direction === 'net_selling' ? 'Dealers SELL' : 'Neutral';

    const badge = document.createElement('div');
    badge.className = `chart-dealer-badge ${cls}`;
    let html = `<div>${arrow} <b>${dirLabel}</b>`;
    if (netFlow != null) html += ` $${Math.abs(netFlow).toFixed(1)}B`;
    html += '</div>';
    if (magnitude) html += `<div style="font-size:0.58rem;opacity:0.8;">${magnitude}${driver ? ' \u00B7 ' + driver : ''}</div>`;
    badge.innerHTML = html;
    container.appendChild(badge);
}

function toggleDealerBadge() {
    saveToggles();
    renderDealerBadge();
}

// Overlay 3: VRP Gauge
function renderVrpGauge() {
    const container = document.getElementById('vrp-gauge-container');
    if (!container) return;

    const data = optionsVizData.vrpData;
    if (!data || !document.getElementById('viz-toggle-vrp')?.checked) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    const iv = data.iv_30d_pct != null ? data.iv_30d_pct : (data.iv_30d || 0);
    const rv = data.rv_20d_pct != null ? data.rv_20d_pct : (data.rv_20d || 0);
    const vrp = data.vrp_pct != null ? data.vrp_pct : (data.vrp || (iv - rv));
    const signal = (data.vrp_signal || '').toUpperCase();
    const isRich = vrp > 0;

    // Bar fill: IV as % of max(IV, RV) range
    const maxVal = Math.max(iv, rv, 1);
    const ivPct = Math.min((iv / (maxVal * 1.3)) * 100, 100);

    const signalColor = isRich ? '#22c55e' : '#ef4444';
    const fillColor = isRich
        ? 'linear-gradient(90deg, rgba(34,197,94,0.4), rgba(34,197,94,0.7))'
        : 'linear-gradient(90deg, rgba(239,68,68,0.4), rgba(239,68,68,0.7))';

    container.innerHTML = `
        <span class="vrp-gauge-label left">RV ${rv.toFixed(1)}%</span>
        <div class="vrp-gauge-bar">
            <div class="vrp-gauge-fill" style="width:${ivPct.toFixed(0)}%;background:${fillColor};"></div>
        </div>
        <span style="font-size:0.72rem;font-weight:700;color:${signalColor};min-width:100px;text-align:center;">
            ${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}% ${isRich ? 'RICH' : 'CHEAP'}
        </span>
        <span class="vrp-gauge-label right">IV ${iv.toFixed(1)}%</span>
    `;
}

function toggleVrpGauge() {
    saveToggles();
    renderVrpGauge();
}

// Overlay 4: GEX Heatmap toggle
function toggleGexHeatmap() {
    saveToggles();
    updatePriceChartLevels();
}

// Overlay 5: Flow Toxicity Strip
function renderFlowStrip() {
    const container = document.getElementById('flow-strip-container');
    if (!container) return;

    const data = optionsVizData.vannaCharmData;
    if (!data || !document.getElementById('viz-toggle-toxicity')?.checked) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    const ft = data.flow_toxicity || {};
    const toxicity = ft.toxicity != null ? ft.toxicity : 0;
    const label = ft.label || (toxicity > 0.7 ? 'HIGH' : toxicity > 0.4 ? 'MODERATE' : 'LOW');
    const direction = ft.flow_direction || '';
    const pctWidth = Math.min(toxicity * 100, 100);

    const toxColor = toxicity > 0.7 ? '#ef4444' : toxicity > 0.4 ? '#f59e0b' : '#22c55e';
    const dirArrow = direction.toLowerCase().includes('bull') ? '\u2B06' : direction.toLowerCase().includes('bear') ? '\u2B07' : '\u2194';

    container.innerHTML = `
        <span class="flow-strip-label left" style="color:${toxColor};">Flow: ${(toxicity * 100).toFixed(0)}% ${label}</span>
        <div class="flow-strip-bar">
            <div class="flow-strip-fill" style="width:${pctWidth.toFixed(0)}%;background:linear-gradient(90deg,#22c55e,#f59e0b ${Math.min(pctWidth * 1.2, 100)}%,#ef4444);"></div>
        </div>
        <span class="flow-strip-label right" style="color:var(--text-muted);">${dirArrow} ${direction || 'Neutral'}</span>
    `;
}

function toggleFlowStrip() {
    saveToggles();
    renderFlowStrip();
}

// =============================================================================
// LIVE PRICE UPDATES
// =============================================================================
function startLivePriceUpdates() {
    // Clean up existing connections
    if (livePriceWs) { livePriceWs.close(); livePriceWs = null; }
    if (livePriceInterval) { clearInterval(livePriceInterval); livePriceInterval = null; }

    const ticker = optionsAnalysisTicker;
    if (!ticker) return;

    const wsBase = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
    // Strip leading / from futures tickers (e.g., /ES → ES) to avoid URL path issues
    const wsTicker = ticker.startsWith('/') ? ticker.substring(1) : ticker;
    const wsUrl = `${wsBase}/ws/quote/${encodeURIComponent(wsTicker)}`;

    try {
        livePriceWs = new WebSocket(wsUrl);

        livePriceWs.onopen = () => {
            wsRetries = 0;
            updateConnectionStatus('live');
        };

        livePriceWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (!data.ok || !data.data) return;
                const price = data.data.last || data.data.price || data.data.mid ||
                             ((data.data.bid + data.data.ask) / 2);
                if (price && price > 0) {
                    updateLivePrice(price);
                }
            } catch (e) {}
        };

        livePriceWs.onclose = () => {
            livePriceWs = null;
            // Auto-reconnect after 5 seconds if still on same ticker (only if not error-triggered)
            if (wsRetries === 0) {
                setTimeout(() => {
                    if (optionsAnalysisTicker === ticker) startLivePriceUpdates();
                }, 5000);
            }
        };

        livePriceWs.onerror = () => {
            if (livePriceWs) { livePriceWs.close(); livePriceWs = null; }
            wsRetries++;
            if (wsRetries <= MAX_WS_RETRIES) {
                setTimeout(() => startLivePriceUpdates(), 2000);
            } else {
                updateConnectionStatus('polling');
                startLivePricePolling();
                // Retry WebSocket every 30s while polling
                setTimeout(() => { wsRetries = 0; startLivePriceUpdates(); }, 30000);
            }
        };
    } catch (e) {
        updateConnectionStatus('polling');
        startLivePricePolling();
    }

    updateLivePrice(optionsVizData.currentPrice);
}

function startLivePricePolling() {
    // Fallback: REST polling every 5 seconds
    if (livePriceInterval) clearInterval(livePriceInterval);
    const ticker = optionsAnalysisTicker;
    if (!ticker) return;

    livePriceInterval = setInterval(async () => {
        try {
            const isFutures = ticker.startsWith('/');
            const tickerParam = encodeURIComponent(ticker);
            const url = isFutures
                ? `${API_BASE}/quote?ticker=${tickerParam}`
                : `${API_BASE}/quote/${ticker}`;

            const res = await fetch(url);
            if (!res.ok) return;

            const data = await res.json();
            if (!data.ok || !data.data) return;

            const price = data.data.last || data.data.price || data.data.mid ||
                         ((data.data.bid + data.data.ask) / 2);

            if (price && price > 0) {
                updateLivePrice(price);
            }
        } catch (e) {}
    }, 5000);
}

function updateConnectionStatus(mode) {
    const statusEl = document.getElementById('live-status');
    const dotEl = document.getElementById('live-status-dot');
    const textEl = document.getElementById('live-status-text');
    if (!statusEl || !dotEl || !textEl) return;
    statusEl.style.display = 'inline';
    if (mode === 'live') {
        dotEl.style.background = '#10b981';
        dotEl.classList.add('pulse-dot');
        textEl.textContent = 'Live';
        textEl.style.color = '#10b981';
    } else {
        dotEl.style.background = '#f59e0b';
        dotEl.classList.remove('pulse-dot');
        textEl.textContent = 'Delayed';
        textEl.style.color = '#f59e0b';
    }
}

function updateLivePrice(price) {
    if (!price || price <= 0) return;

    // Update candlestick chart if it exists
    if (priceSeries && optionsVizData.candles.length > 0) {
        const isIntraday = INTERVAL_DAYS_MAP[selectedInterval] !== null;
        const lastCandle = optionsVizData.candles[optionsVizData.candles.length - 1];

        if (isIntraday) {
            // For intraday, update the last candle directly
            if (lastCandle) {
                const updatedCandle = {
                    time: lastCandle.time,
                    open: lastCandle.open,
                    high: Math.max(lastCandle.high, price),
                    low: Math.min(lastCandle.low, price),
                    close: price,
                    volume: lastCandle.volume || 0
                };
                priceSeries.update(updatedCandle);
                optionsVizData.candles[optionsVizData.candles.length - 1] = updatedCandle;
            }
        } else {
            // Daily/weekly: match candle time format (could be string "YYYY-MM-DD" or object {year,month,day})
            const today = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/New_York'}));
            const y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate();
            const todayStr = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            const lastTime = lastCandle ? lastCandle.time : null;

            // Check if last candle is today OR ahead of today (timezone edge case:
            // API may return UTC dates while NY is still on the previous day)
            const isTodayOrAhead = lastTime && (typeof lastTime === 'string'
                ? lastTime >= todayStr
                : (lastTime.year > y || (lastTime.year === y && (lastTime.month > m || (lastTime.month === m && lastTime.day >= d)))));

            if (lastCandle && isTodayOrAhead) {
                // Today's (or most recent) candle exists — update OHLC
                const updatedCandle = {
                    time: lastCandle.time,
                    open: lastCandle.open,
                    high: Math.max(lastCandle.high, price),
                    low: Math.min(lastCandle.low, price),
                    close: price,
                    volume: lastCandle.volume || 0
                };
                try { priceSeries.update(updatedCandle); } catch(e) {}
                optionsVizData.candles[optionsVizData.candles.length - 1] = updatedCandle;
            } else {
                // No candle for today — only create one on weekdays (trading days)
                const dayOfWeek = today.getDay();
                const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
                if (isWeekday) {
                    const useObjFormat = optionsVizData.candles.length > 0 && typeof optionsVizData.candles[0].time === 'object';
                    const newTime = useObjFormat ? { year: y, month: m, day: d } : todayStr;
                    const newCandle = {
                        time: newTime,
                        open: price,
                        high: price,
                        low: price,
                        close: price,
                        volume: 0
                    };
                    try { priceSeries.update(newCandle); } catch(e) {}
                    optionsVizData.candles.push(newCandle);
                }
                // Weekend/holiday: don't create a fake candle, just update price displays
            }
        }
    }

    optionsVizData.currentPrice = price;
    optionsChartData.currentPrice = price;

    // Update ALL price displays across the page (with flash animation)
    const priceEl = document.getElementById('viz-current-price');
    if (priceEl) {
        const oldPrice = priceEl.textContent;
        priceEl.textContent = `$${price.toFixed(2)}`;
        flashValue(priceEl, price, oldPrice);
    }

    // Analysis tab current price
    const oaPriceEl = document.getElementById('oa-current-price');
    if (oaPriceEl) {
        const oldOaPrice = oaPriceEl.textContent;
        oaPriceEl.textContent = `$${price.toFixed(2)}`;
        flashValue(oaPriceEl, price, oldOaPrice);
    }

    // Push sparkline data for price
    pushSparklineValue('price', price);
    const priceSpark = document.getElementById('sparkline-price');
    if (priceSpark && _sparklineData.price) renderSparkline(priceSpark, _sparklineData.price);

    // GEX dashboard distance percentages
    const callWall = optionsVizData.callWall;
    const putWall = optionsVizData.putWall;
    const gammaFlip = optionsVizData.gammaFlip;

    const cwDistEl = document.getElementById('gex-call-wall-dist');
    if (cwDistEl && callWall > 0) {
        const cwDist = ((callWall - price) / price * 100).toFixed(1);
        cwDistEl.textContent = `${cwDist >= 0 ? '+' : ''}${cwDist}% from price`;
    }
    const pwDistEl = document.getElementById('gex-put-wall-dist');
    if (pwDistEl && putWall > 0) {
        const pwDist = ((putWall - price) / price * 100).toFixed(1);
        pwDistEl.textContent = `${pwDist >= 0 ? '+' : ''}${pwDist}% from price`;
    }

    // Max pain distance on analysis tab
    const mpDistEl = document.getElementById('oa-mp-dist');
    if (mpDistEl && optionsVizData.maxPain > 0) {
        const mpDist = ((optionsVizData.maxPain - price) / price * 100);
        mpDistEl.textContent = `${mpDist >= 0 ? '+' : ''}${mpDist.toFixed(1)}%`;
        mpDistEl.className = mpDist >= 0 ? 'mp-dist positive' : 'mp-dist negative';
    }

    updateVizInfoBar();
}

// =============================================================================
// RENDER GEX CHART
// =============================================================================
function renderVizGexChart() {
    const chartDiv = document.getElementById('gex-chart-container');

    if (!chartDiv) {
        console.warn('renderVizGexChart: gex-chart-container not found');
        return;
    }

    const showGexChart = document.getElementById('viz-toggle-gex')?.checked ?? true;

    if (!showGexChart) {
        chartDiv.style.display = 'none';
        return;
    }

    chartDiv.style.display = 'block';

    if (!optionsVizData.gexByStrike || optionsVizData.gexByStrike.length === 0) {
        chartDiv.innerHTML = '<div class="chart-loading">No GEX data available</div>';
        return;
    }

    let data = optionsVizData.gexByStrike.slice();
    const currentPrice = optionsVizData.currentPrice;

    if (currentPrice > 0 && data.length > 15) {
        const minRange = currentPrice * 0.88;
        const maxRange = currentPrice * 1.12;
        const filtered = data.filter(d => d.strike >= minRange && d.strike <= maxRange);
        if (filtered.length >= 5) {
            data = filtered;
        }
    }

    if (data.length > 30) {
        const centerIdx = data.findIndex(d => d.strike >= currentPrice) || Math.floor(data.length / 2);
        const start = Math.max(0, centerIdx - 15);
        const end = Math.min(data.length, centerIdx + 15);
        data = data.slice(start, end);
    }

    if (data.length === 0) {
        chartDiv.innerHTML = '<div class="chart-loading">No data in visible range</div>';
        return;
    }

    const strikes = data.map(d => d.strike);
    const netGexData = data.map(d => (d.netGex / 1e6));
    const barColors = netGexData.map(val => val >= 0 ? '#22c55e' : '#ef4444');

    const xAxisAnnotations = [];

    if (currentPrice > 0) {
        xAxisAnnotations.push({
            x: currentPrice,
            borderColor: '#ffffff',
            borderWidth: 3,
            label: {
                text: `Price: $${currentPrice.toFixed(0)}`,
                style: {
                    color: '#ffffff',
                    background: 'rgba(0,0,0,0.7)',
                    fontSize: '11px',
                    fontWeight: 600
                },
                position: 'top'
            }
        });
    }

    if (optionsVizData.callWall > 0) {
        xAxisAnnotations.push({
            x: optionsVizData.callWall,
            borderColor: '#ef4444',
            borderWidth: 2,
            strokeDashArray: 5,
            label: {
                text: `Call Wall: $${optionsVizData.callWall.toFixed(0)}`,
                style: { color: '#ef4444', background: 'rgba(239,68,68,0.15)', fontSize: '10px' },
                position: 'top', offsetY: 20
            }
        });
    }

    if (optionsVizData.putWall > 0) {
        xAxisAnnotations.push({
            x: optionsVizData.putWall,
            borderColor: '#22c55e',
            borderWidth: 2,
            strokeDashArray: 5,
            label: {
                text: `Put Wall: $${optionsVizData.putWall.toFixed(0)}`,
                style: { color: '#22c55e', background: 'rgba(34,197,94,0.15)', fontSize: '10px' },
                position: 'top', offsetY: 40
            }
        });
    }

    const options = {
        chart: {
            type: 'bar',
            height: 200,
            background: 'transparent',
            toolbar: { show: true },
            animations: { enabled: true, speed: 400 }
        },
        theme: { mode: 'dark' },
        series: [{ name: 'Net GEX (M)', type: 'bar', data: netGexData }],
        colors: barColors,
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '70%',
                borderRadius: 2,
                distributed: true
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: strikes.map(s => `$${s}`),
            labels: {
                rotate: -45,
                rotateAlways: strikes.length > 15,
                style: { colors: '#71717a', fontSize: '10px' }
            },
            title: { text: 'Strike Price', style: { color: '#71717a', fontSize: '11px' } }
        },
        yaxis: {
            title: { text: 'GEX (Millions)', style: { color: '#71717a', fontSize: '11px' } },
            labels: {
                style: { colors: '#71717a', fontSize: '10px' },
                formatter: val => val.toFixed(1) + 'M'
            }
        },
        tooltip: {
            theme: 'dark',
            y: {
                formatter: val => `$${(val * 1e6).toLocaleString()} (${val.toFixed(2)}M)`
            }
        },
        legend: { show: false },
        grid: {
            borderColor: '#2a2a3a',
            strokeDashArray: 3
        },
        annotations: { xaxis: xAxisAnnotations }
    };

    if (optionsVizChart) {
        optionsVizChart.destroy();
        optionsVizChart = null;
    }

    optionsVizChart = new ApexCharts(chartDiv, options);
    optionsVizChart.render();
}

// =============================================================================
// TOGGLE GEX CHART
// =============================================================================
function toggleGexChart() {
    const chartDiv = document.getElementById('gex-chart-container');
    const showGex = document.getElementById('viz-toggle-gex')?.checked ?? true;

    if (chartDiv) {
        chartDiv.style.display = showGex ? 'block' : 'none';
    }

    if (showGex && optionsVizData.gexByStrike.length > 0) {
        renderVizGexChart();
    }
    if (document.fullscreenElement) setTimeout(resizeChartsToFit, 50);
}

// =============================================================================
// UPDATE OPTIONS VIZ
// =============================================================================
function updateOptionsViz() {
    updatePriceChartLevels();

    if (optionsVizData.gexByStrike && optionsVizData.gexByStrike.length > 0) {
        renderVizGexChart();
    }
}

function refreshOptionsViz() {
    const ticker = optionsAnalysisTicker;
    if (!ticker) {
        alert('Please analyze a ticker first');
        return;
    }
    // Persist timeframe selection
    var tf = document.getElementById('viz-timeframe');
    if (tf) localStorage.setItem('gq_timeframe', tf.value);
    loadOptionsViz(ticker);
}

// =============================================================================
// FULLSCREEN
// =============================================================================
function toggleChartFullscreen() {
    var container = document.getElementById('options-viz-container');
    if (!container) return;
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        container.requestFullscreen().catch(function() {});
    }
}

function resizeChartsToFit() {
    var pc = document.getElementById('price-chart-container');
    if (!pc || pc.clientWidth === 0) return;
    var h = pc.clientHeight;
    if (h < 50) h = 500;
    if (priceChart) {
        priceChart.applyOptions({ width: pc.clientWidth, height: h });
        priceChart.timeScale().fitContent();
        vpDebouncedRedraw();
    }
    if (rsiChart) {
        var rc = document.getElementById('rsi-chart-container');
        if (rc && rc.clientWidth > 0) rsiChart.applyOptions({ width: rc.clientWidth, height: rc.clientHeight || 100 });
    }
    if (rsChart) {
        var rsc = document.getElementById('rs-chart-container');
        if (rsc && rsc.clientWidth > 0) rsChart.applyOptions({ width: rsc.clientWidth, height: rsc.clientHeight || 100 });
    }
    if (cotChart) {
        var cc = document.getElementById('cot-chart-container');
        if (cc && cc.clientWidth > 0) cotChart.applyOptions({ width: cc.clientWidth, height: cc.clientHeight || 120 });
    }
}

document.addEventListener('fullscreenchange', function() {
    var container = document.getElementById('options-viz-container');
    var btn = container ? container.querySelector('.fullscreen-btn') : null;
    if (document.fullscreenElement) {
        if (container) container.classList.add('chart-fullscreen');
        if (btn) btn.textContent = '\u2716';
    } else {
        if (container) container.classList.remove('chart-fullscreen');
        if (btn) btn.textContent = '\u26F6';
    }
    setTimeout(resizeChartsToFit, 100);
});

// =============================================================================
// INTERVAL SELECTION
// =============================================================================
function setInterval_(interval) {
    selectedInterval = interval;
    localStorage.setItem('gq_interval', interval);

    // Toggle active class on buttons
    document.querySelectorAll('.interval-btn').forEach(btn => btn.classList.remove('active'));
    const buttons = document.querySelectorAll('.interval-btn');
    buttons.forEach(btn => {
        const label = btn.textContent.trim().toLowerCase();
        if (label === interval || (interval === '1d' && label === '1d') || (interval === '1w' && label === '1w')) {
            btn.classList.add('active');
        }
    });

    const tfSelect = document.getElementById('viz-timeframe');
    if (INTERVAL_DAYS_MAP[interval] !== null) {
        // Intraday: disable timeframe dropdown since days are auto-mapped
        if (tfSelect) tfSelect.disabled = true;
    } else {
        // Daily/weekly: re-enable timeframe dropdown
        if (tfSelect) tfSelect.disabled = false;
    }

    refreshOptionsViz();
}

// =============================================================================
// LOG SCALE & AUTO SCALE
// =============================================================================
let isLogScale = localStorage.getItem('gq_log_scale') === 'true';
let isAutoScale = localStorage.getItem('gq_auto_scale') !== 'false'; // default true

function toggleLogScale() {
    isLogScale = !isLogScale;
    localStorage.setItem('gq_log_scale', isLogScale);
    const btn = document.getElementById('btn-log-scale');
    if (btn) btn.classList.toggle('active', isLogScale);
    if (priceChart) {
        priceChart.priceScale('right').applyOptions({
            mode: isLogScale ? 1 : 0,
        });
    }
}

function toggleAutoScale() {
    isAutoScale = !isAutoScale;
    localStorage.setItem('gq_auto_scale', isAutoScale);
    const btn = document.getElementById('btn-auto-scale');
    if (btn) btn.classList.toggle('active', isAutoScale);
    if (priceChart) {
        priceChart.priceScale('right').applyOptions({
            autoScale: isAutoScale,
        });
    }
}

function applyScaleButtons() {
    const logBtn = document.getElementById('btn-log-scale');
    const autoBtn = document.getElementById('btn-auto-scale');
    if (logBtn) logBtn.classList.toggle('active', isLogScale);
    if (autoBtn) autoBtn.classList.toggle('active', isAutoScale);
}

// === Toggle Presets ===
const TOGGLE_PRESETS = {
    options: ['viz-toggle-callwall','viz-toggle-putwall','viz-toggle-gammaflip','viz-toggle-maxpain','viz-toggle-val','viz-toggle-poc','viz-toggle-vah','viz-toggle-vp','viz-toggle-gex'],
    technicals: ['viz-toggle-sma20','viz-toggle-sma50','viz-toggle-sma200','viz-toggle-vwap','viz-toggle-bb','viz-toggle-rsi','viz-toggle-volume'],
    intel: ['viz-toggle-em','viz-toggle-regime','viz-toggle-vrp','viz-toggle-gexheat','viz-toggle-toxicity','viz-toggle-dealer','viz-toggle-flow']
};
const ALL_TOGGLE_IDS = [...new Set(Object.values(TOGGLE_PRESETS).flat())];

function applyTogglePreset(preset) {
    const ids = TOGGLE_PRESETS[preset];
    if (!ids) return;
    ALL_TOGGLE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.checked) { el.checked = false; el.dispatchEvent(new Event('change')); }
    });
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change')); }
    });
    document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    localStorage.setItem('gq_toggle_preset', preset);
}

function toggleCustomToggles() {
    const w = document.getElementById('custom-toggles');
    if (!w) return;
    const open = w.style.display !== 'none';
    w.style.display = open ? 'none' : '';
    document.querySelector('.preset-custom-btn').innerHTML = open ? 'Custom &#9662;' : 'Custom &#9652;';
}

function restoreTogglePreset() {
    const saved = localStorage.getItem('gq_toggle_preset');
    if (saved && TOGGLE_PRESETS[saved]) applyTogglePreset(saved);
}

// =============================================================================
// VOLUME SERIES
// =============================================================================
function addVolumeSeries() {
    if (!priceChart || !optionsVizData.candles || optionsVizData.candles.length === 0) return;

    volumeSeries = priceChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        scaleMargins: { top: 0.8, bottom: 0 },
    });

    priceChart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
    });

    const volData = optionsVizData.candles.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)'
    }));

    volumeSeries.setData(volData);
}

function toggleVolumeSeries() {
    const show = document.getElementById('viz-toggle-volume')?.checked;
    if (show) {
        if (!volumeSeries && priceChart) {
            addVolumeSeries();
        }
    } else {
        if (volumeSeries && priceChart) {
            try { priceChart.removeSeries(volumeSeries); } catch(e) {}
            volumeSeries = null;
        }
    }
}

// =============================================================================
// VOLUME PROFILE HISTOGRAM OVERLAY
// =============================================================================
function computeVolumeProfile(candles) {
    if (!candles || candles.length < 2) return null;
    // Adaptive bin count: scale with price range granularity
    let minLow = Infinity, maxHigh = -Infinity;
    for (let i = 0; i < candles.length; i++) {
        if (candles[i].low < minLow) minLow = candles[i].low;
        if (candles[i].high > maxHigh) maxHigh = candles[i].high;
    }
    if (maxHigh <= minLow) return null;
    const range = maxHigh - minLow;
    // Adaptive bins: more bins for wider ranges, min 40, max 120
    const NUM_BINS = Math.max(40, Math.min(120, Math.round(candles.length * 0.6)));
    const binSize = range / NUM_BINS;
    const bins = [];
    for (let i = 0; i < NUM_BINS; i++) {
        const priceLow = minLow + i * binSize;
        const priceHigh = priceLow + binSize;
        bins.push({ price: (priceLow + priceHigh) / 2, priceLow, priceHigh, volume: 0, buyVol: 0, sellVol: 0 });
    }
    // Distribute each candle's volume across bins its [low,high] range covers
    // Split into buy/sell based on candle direction (close vs open)
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const vol = c.volume || 0;
        if (vol <= 0) continue;
        const isBuy = c.close >= c.open;
        const lo = Math.max(0, Math.floor((c.low - minLow) / binSize));
        const hi = Math.min(NUM_BINS - 1, Math.floor((c.high - minLow) / binSize - 0.0001));
        const span = hi - lo + 1;
        const perBin = vol / span;
        for (let b = lo; b <= hi; b++) {
            bins[b].volume += perBin;
            if (isBuy) bins[b].buyVol += perBin;
            else bins[b].sellVol += perBin;
        }
    }
    // Find POC (highest volume bin)
    let pocIndex = 0, maxVol = 0;
    for (let i = 0; i < bins.length; i++) {
        if (bins[i].volume > maxVol) { maxVol = bins[i].volume; pocIndex = i; }
    }
    // Compute 70% value area expanding outward from POC
    const totalVol = bins.reduce((s, b) => s + b.volume, 0);
    const targetVol = totalVol * 0.70;
    let vaVol = bins[pocIndex].volume;
    let lo = pocIndex, hi = pocIndex;
    while (vaVol < targetVol && (lo > 0 || hi < bins.length - 1)) {
        const loVol = lo > 0 ? bins[lo - 1].volume : -1;
        const hiVol = hi < bins.length - 1 ? bins[hi + 1].volume : -1;
        if (loVol >= hiVol && lo > 0) { lo--; vaVol += bins[lo].volume; }
        else if (hi < bins.length - 1) { hi++; vaVol += bins[hi].volume; }
        else break;
    }
    return { bins, pocIndex, valIndex: lo, vahIndex: hi, maxVolume: maxVol };
}

// Get visible candles based on current chart viewport
function getVisibleCandles() {
    if (!priceChart || !optionsVizData.candles || optionsVizData.candles.length < 2) return null;
    try {
        const logicalRange = priceChart.timeScale().getVisibleLogicalRange();
        if (!logicalRange) return null;
        const candles = optionsVizData.candles;
        const from = Math.max(0, Math.floor(logicalRange.from));
        const to = Math.min(candles.length - 1, Math.ceil(logicalRange.to));
        if (to - from < 2) return null;
        return candles.slice(from, to + 1);
    } catch (e) {
        return null;
    }
}

function vpDrawRoundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    if (r < 0.5) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function renderVolumeProfileOverlay() {
    if (!document.getElementById('viz-toggle-vp')?.checked || !priceSeries || !priceChart) {
        removeVolumeProfileOverlay();
        return;
    }
    const container = document.getElementById('price-chart-container');
    if (!container || container.clientWidth === 0) return;

    // Compute VP from visible candles (recompute when range changes)
    const visibleCandles = getVisibleCandles();
    const candlesToUse = visibleCandles || optionsVizData.candles;
    const rangeKey = candlesToUse ? (candlesToUse.length + '_' + (candlesToUse[0]?.time || '') + '_' + (candlesToUse[candlesToUse.length - 1]?.time || '')) : '';
    if (rangeKey !== vpLastRangeKey || !vpProfileData) {
        vpProfileData = computeVolumeProfile(candlesToUse);
        vpLastRangeKey = rangeKey;
    }
    if (!vpProfileData) return;

    // Create or reuse canvas
    if (!vpCanvas) {
        vpCanvas = document.createElement('canvas');
        vpCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;pointer-events:none;';
        container.style.position = 'relative';
        container.appendChild(vpCanvas);
        vpCtx = vpCanvas.getContext('2d');
        // Tooltip setup
        vpTooltip = document.createElement('div');
        vpTooltip.style.cssText = 'position:absolute;display:none;z-index:15;pointer-events:none;background:rgba(20,20,30,0.92);border:1px solid rgba(100,149,237,0.5);border-radius:6px;padding:5px 9px;font-size:10.5px;color:#e2e8f0;white-space:nowrap;line-height:1.5;backdrop-filter:blur(4px);';
        container.appendChild(vpTooltip);
        // Mouse handlers on container (not vpCanvas) so LightweightCharts still gets events
        container.addEventListener('mousemove', vpHandleMouseMove);
        container.addEventListener('mouseleave', vpHandleMouseLeave);
    }

    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    vpCanvas.width = cw * dpr;
    vpCanvas.height = ch * dpr;
    vpCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vpCtx.clearRect(0, 0, cw, ch);

    // Get chart area width (where price axis starts)
    let chartAreaWidth;
    try {
        chartAreaWidth = priceChart.timeScale().width();
    } catch (e) {
        chartAreaWidth = cw - 60;
    }

    const { bins, pocIndex, valIndex, vahIndex, maxVolume } = vpProfileData;
    if (maxVolume <= 0) return;
    const maxBarWidth = chartAreaWidth * 0.18;
    // Distance from POC for gradient fade
    const maxDist = Math.max(pocIndex - 0, bins.length - 1 - pocIndex, 1);

    // Store bar rects for hit-testing (tooltip)
    vpCanvas._barRects = [];

    for (let i = 0; i < bins.length; i++) {
        const bin = bins[i];
        if (bin.volume <= 0) continue;
        const y = priceSeries.priceToCoordinate(bin.price);
        if (y === null || y === undefined) continue;
        const yTop = priceSeries.priceToCoordinate(bin.priceHigh);
        const yBot = priceSeries.priceToCoordinate(bin.priceLow);
        const barHeight = (yTop !== null && yBot !== null) ? Math.max(Math.abs(yBot - yTop), 1.5) : 2;
        const totalBarWidth = (bin.volume / maxVolume) * maxBarWidth;
        const buyRatio = bin.volume > 0 ? bin.buyVol / bin.volume : 0.5;
        const buyWidth = totalBarWidth * buyRatio;
        const sellWidth = totalBarWidth - buyWidth;

        // Gradient opacity: fade out farther from value area
        const dist = (i < valIndex) ? valIndex - i : (i > vahIndex) ? i - vahIndex : 0;
        const fadeFactor = (i >= valIndex && i <= vahIndex) ? 1.0 : Math.max(0.3, 1.0 - (dist / maxDist) * 0.7);

        const isPOC = i === pocIndex;
        const isVA = i >= valIndex && i <= vahIndex;
        const barX = chartAreaWidth - totalBarWidth;
        const barY = y - barHeight / 2;
        const radius = Math.min(2.5, barHeight / 2);

        // Draw buy portion (green-tinted) then sell portion (red-tinted), or solid for POC
        if (isPOC) {
            const alpha = (0.55 * fadeFactor).toFixed(2);
            vpCtx.beginPath();
            vpDrawRoundedRect(vpCtx, barX, barY, totalBarWidth, barHeight, radius);
            vpCtx.fillStyle = `rgba(217,70,239,${alpha})`;
            vpCtx.fill();
            // Thin bright border for POC
            vpCtx.strokeStyle = 'rgba(217,70,239,0.7)';
            vpCtx.lineWidth = 0.8;
            vpCtx.stroke();
        } else {
            // Sell portion (left, red-tinted)
            if (sellWidth > 0.5) {
                const sAlpha = (isVA ? 0.40 : 0.25) * fadeFactor;
                vpCtx.beginPath();
                vpDrawRoundedRect(vpCtx, barX, barY, sellWidth, barHeight, Math.min(radius, sellWidth / 2));
                vpCtx.fillStyle = `rgba(239,100,100,${sAlpha.toFixed(2)})`;
                vpCtx.fill();
            }
            // Buy portion (right, blue/green-tinted)
            if (buyWidth > 0.5) {
                const bAlpha = (isVA ? 0.40 : 0.25) * fadeFactor;
                vpCtx.beginPath();
                vpDrawRoundedRect(vpCtx, barX + sellWidth, barY, buyWidth, barHeight, Math.min(radius, buyWidth / 2));
                vpCtx.fillStyle = `rgba(100,149,237,${bAlpha.toFixed(2)})`;
                vpCtx.fill();
            }
            // Thin border for value area bars
            if (isVA) {
                vpCtx.beginPath();
                vpDrawRoundedRect(vpCtx, barX, barY, totalBarWidth, barHeight, radius);
                vpCtx.strokeStyle = 'rgba(100,149,237,0.3)';
                vpCtx.lineWidth = 0.5;
                vpCtx.stroke();
            }
        }

        // Store rect for hit-testing
        vpCanvas._barRects.push({ x: barX, y: barY, w: totalBarWidth, h: barHeight, bin, index: i, isPOC, isVA });
    }

    // POC label
    const pocBin = bins[pocIndex];
    const pocY = priceSeries.priceToCoordinate(pocBin.price);
    if (pocY !== null && pocY !== undefined) {
        const pocBarW = (pocBin.volume / maxVolume) * maxBarWidth;
        const labelX = chartAreaWidth - pocBarW - 4;
        vpCtx.font = '600 9px -apple-system, BlinkMacSystemFont, sans-serif';
        vpCtx.textAlign = 'right';
        vpCtx.textBaseline = 'middle';
        vpCtx.fillStyle = 'rgba(217,70,239,0.85)';
        vpCtx.fillText('POC', labelX, pocY);
    }
}

function vpHandleMouseMove(e) {
    if (!vpCanvas || !vpCanvas._barRects || !vpTooltip) return;
    const rect = vpCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit = null;
    for (let i = vpCanvas._barRects.length - 1; i >= 0; i--) {
        const r = vpCanvas._barRects[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
            hit = r; break;
        }
    }
    if (!hit) {
        // Also check within 4px vertically for near-misses
        for (let i = vpCanvas._barRects.length - 1; i >= 0; i--) {
            const r = vpCanvas._barRects[i];
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y - 4 && my <= r.y + r.h + 4) {
                hit = r; break;
            }
        }
    }
    if (hit) {
        const b = hit.bin;
        const fmtVol = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString();
        const fmtPrc = (v) => v.toFixed(2);
        const buyPct = b.volume > 0 ? (b.buyVol / b.volume * 100).toFixed(0) : '50';
        const sellPct = b.volume > 0 ? (b.sellVol / b.volume * 100).toFixed(0) : '50';
        const tag = hit.isPOC ? ' <span style="color:#d946ef;font-weight:700;">POC</span>' : (hit.isVA ? ' <span style="color:#6495ed;">VA</span>' : '');
        vpTooltip.innerHTML =
            `<div style="font-weight:600;margin-bottom:2px;">${fmtPrc(b.priceLow)} - ${fmtPrc(b.priceHigh)}${tag}</div>` +
            `<div>Vol: <b>${fmtVol(b.volume)}</b></div>` +
            `<div><span style="color:#6495ed;">Buy ${buyPct}%</span> / <span style="color:#ef6464;">Sell ${sellPct}%</span></div>`;
        // Position tooltip with viewport clamping
        const ttW = vpTooltip.offsetWidth || 160;
        const ttH = vpTooltip.offsetHeight || 60;
        const ttX = Math.max(10, Math.min(e.clientX - rect.left + 12, rect.width - ttW - 10));
        const ttY = Math.max(4, Math.min(e.clientY - rect.top - 50, rect.height - ttH - 10));
        vpTooltip.style.left = ttX + 'px';
        vpTooltip.style.top = ttY + 'px';
        vpTooltip.style.display = 'block';
    } else {
        vpTooltip.style.display = 'none';
    }
}

function vpHandleMouseLeave() {
    if (vpTooltip) vpTooltip.style.display = 'none';
}

function removeVolumeProfileOverlay() {
    if (vpCanvas) {
        var vpContainer = vpCanvas.parentElement;
        if (vpContainer) {
            vpContainer.removeEventListener('mousemove', vpHandleMouseMove);
            vpContainer.removeEventListener('mouseleave', vpHandleMouseLeave);
        }
        vpCanvas.remove();
        vpCanvas = null;
        vpCtx = null;
    }
    if (vpTooltip) {
        vpTooltip.remove();
        vpTooltip = null;
    }
    vpLastRangeKey = null;
}

// Debounced VP redraw for scroll/zoom events
let _vpLastDims = { w: 0, h: 0 };
function vpDebouncedRedraw() {
    if (vpRedrawTimer) clearTimeout(vpRedrawTimer);
    vpRedrawTimer = setTimeout(() => {
        const container = document.getElementById('price-chart-container');
        if (container) {
            const w = container.clientWidth, h = container.clientHeight;
            if (Math.abs(w - _vpLastDims.w) < 5 && Math.abs(h - _vpLastDims.h) < 5 && vpLastRangeKey) {
                // Dimensions unchanged and range key exists — still redraw for scroll
            }
            _vpLastDims.w = w;
            _vpLastDims.h = h;
        }
        renderVolumeProfileOverlay();
    }, 200);
}

function toggleVolumeProfile() {
    saveToggles();
    if (document.getElementById('viz-toggle-vp')?.checked) {
        vpProfileData = null;
        vpLastRangeKey = null;
        renderVolumeProfileOverlay();
    } else {
        removeVolumeProfileOverlay();
    }
}

// =============================================================================
// TECHNICAL INDICATOR CALCULATIONS
// =============================================================================
function calcSMA(candles, period) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += candles[j].close;
        }
        result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
}

function calcVWAP(candles, resetDaily) {
    const result = [];
    let cumVol = 0, cumTP = 0;
    let prevDate = null;

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const tp = (c.high + c.low + c.close) / 3;
        const vol = c.volume || 0;

        // Reset daily for intraday intervals
        if (resetDaily && vol > 0) {
            const d = new Date(typeof c.time === 'number' ? c.time * 1000 : c.time);
            const dateStr = d.toISOString().slice(0, 10);
            if (dateStr !== prevDate) {
                cumVol = 0;
                cumTP = 0;
                prevDate = dateStr;
            }
        }

        cumVol += vol;
        cumTP += tp * vol;

        if (cumVol > 0) {
            result.push({ time: c.time, value: cumTP / cumVol });
        }
    }
    return result;
}

function calcBollingerBands(candles, period, mult) {
    const middle = [], upper = [], lower = [];
    for (let i = period - 1; i < candles.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += candles[j].close;
        }
        const mean = sum / period;

        let sqSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sqSum += (candles[j].close - mean) ** 2;
        }
        const std = Math.sqrt(sqSum / period);

        middle.push({ time: candles[i].time, value: mean });
        upper.push({ time: candles[i].time, value: mean + mult * std });
        lower.push({ time: candles[i].time, value: mean - mult * std });
    }
    return { middle, upper, lower };
}

function calcRSI(candles, period) {
    if (candles.length < period + 1) return [];

    const result = [];
    let avgGain = 0, avgLoss = 0;

    // Initial average
    for (let i = 1; i <= period; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[period].time, value: 100 - (100 / (1 + rs)) });

    // Smoothed
    for (let i = period + 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push({ time: candles[i].time, value: 100 - (100 / (1 + rs2)) });
    }
    return result;
}

function calcRS(tickerCandles, spyCandles, smaPeriod) {
    smaPeriod = smaPeriod || 50;
    if (!tickerCandles || !tickerCandles.length || !spyCandles || !spyCandles.length) return { rs: [], sma: [] };

    function timeKey(t) {
        if (typeof t === 'object' && t.year != null) {
            return t.year + '-' + String(t.month).padStart(2, '0') + '-' + String(t.day).padStart(2, '0');
        }
        return String(t);
    }

    // Build SPY lookup by time
    var spyMap = new Map();
    spyCandles.forEach(function(c) {
        spyMap.set(timeKey(c.time), c.close);
    });

    // Calculate RS ratio for each matching candle
    var rsData = [];
    tickerCandles.forEach(function(c) {
        var spyClose = spyMap.get(timeKey(c.time));
        if (spyClose && spyClose > 0) {
            rsData.push({ time: c.time, value: c.close / spyClose });
        }
    });

    // Calculate SMA of RS ratio
    var smaData = [];
    for (var i = smaPeriod - 1; i < rsData.length; i++) {
        var sum = 0;
        for (var j = i - smaPeriod + 1; j <= i; j++) sum += rsData[j].value;
        smaData.push({ time: rsData[i].time, value: sum / smaPeriod });
    }

    return { rs: rsData, sma: smaData };
}

// =============================================================================
// UPDATE INDICATORS ON PRICE CHART
// =============================================================================
function updateIndicators() {
    if (!priceChart || !priceSeries) return;

    // Remove existing indicator series
    Object.values(indicatorSeries).forEach(s => {
        if (s) {
            try { priceChart.removeSeries(s); } catch(e) {}
        }
    });
    indicatorSeries = {};

    const candles = optionsVizData.candles;
    if (!candles || candles.length < 2) return;

    const addLine = (id, data, color, lineWidth, lineStyle) => {
        if (data.length === 0) return;
        const series = priceChart.addLineSeries({
            color: color,
            lineWidth: lineWidth || 1,
            lineStyle: lineStyle || LightweightCharts.LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        series.setData(data);
        indicatorSeries[id] = series;
    };

    // SMA 20
    if (document.getElementById('viz-toggle-sma20')?.checked) {
        addLine('sma20', calcSMA(candles, 20), '#eab308', 1);
    }

    // SMA 50
    if (document.getElementById('viz-toggle-sma50')?.checked) {
        addLine('sma50', calcSMA(candles, 50), '#06b6d4', 1);
    }

    // SMA 200
    if (document.getElementById('viz-toggle-sma200')?.checked) {
        addLine('sma200', calcSMA(candles, 200), '#d946ef', 1);
    }

    // VWAP
    if (document.getElementById('viz-toggle-vwap')?.checked) {
        const isIntraday = INTERVAL_DAYS_MAP[selectedInterval] !== null;
        addLine('vwap', calcVWAP(candles, isIntraday), '#fbbf24', 2);
    }

    // Bollinger Bands
    if (document.getElementById('viz-toggle-bb')?.checked) {
        const bb = calcBollingerBands(candles, 20, 2);
        addLine('bbMiddle', bb.middle, '#818cf8', 1);
        addLine('bbUpper', bb.upper, 'rgba(129, 140, 248, 0.6)', 1, LightweightCharts.LineStyle.Dashed);
        addLine('bbLower', bb.lower, 'rgba(129, 140, 248, 0.6)', 1, LightweightCharts.LineStyle.Dashed);
    }
}

// =============================================================================
// RSI CHART
// =============================================================================
function renderRsiChart() {
    const container = document.getElementById('rsi-chart-container');
    if (!container) return;

    // Destroy existing
    if (rsiChart) {
        try { rsiChart.remove(); } catch(e) {}
        rsiChart = null;
        rsiSeries = null;
    }

    const candles = optionsVizData.candles;
    if (!candles || candles.length < 16) {
        container.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">Not enough data for RSI</div>';
        return;
    }

    container.innerHTML = '';

    rsiChart = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.03)' },
            horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(224, 227, 235, 0.4)', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#363A45' },
            horzLine: { color: 'rgba(224, 227, 235, 0.4)', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#363A45' },
        },
        handleScale: { mouseWheel: false, pinch: false },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.1)',
            autoScale: false,
            scaleMargins: { top: 0.05, bottom: 0.05 },
        },
        timeScale: { visible: false },
        width: container.clientWidth,
        height: 100,
    });

    // Force scale 0-100
    rsiSeries = rsiChart.addLineSeries({
        color: '#a855f7',
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
    });

    const rsiData = calcRSI(candles, 14);
    rsiSeries.setData(rsiData);

    // Overbought line at 70
    rsiSeries.createPriceLine({
        price: 70,
        color: 'rgba(239, 68, 68, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
    });

    // Oversold line at 30
    rsiSeries.createPriceLine({
        price: 30,
        color: 'rgba(34, 197, 94, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
    });

    // Sync visible range with main chart
    if (priceChart) {
        priceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (rsiChart && range) {
                try { rsiChart.timeScale().setVisibleLogicalRange(range); } catch(e) {}
            }
        });
    }

    // Crosshair sync: main → RSI
    if (priceChart) {
        priceChart.subscribeCrosshairMove(param => {
            if (!rsiChart || !param || !param.time) return;
            try { rsiChart.setCrosshairPosition(undefined, param.time, rsiSeries); } catch(e) {}
        });
        rsiChart.subscribeCrosshairMove(param => {
            if (!priceChart || !param || !param.time) return;
            try { priceChart.setCrosshairPosition(undefined, param.time, priceSeries); } catch(e) {}
        });
    }

    // ResizeObserver
    const ro = new ResizeObserver(() => {
        if (rsiChart && container.clientWidth > 0) {
            rsiChart.applyOptions({ width: container.clientWidth });
        }
    });
    ro.observe(container);
}

function toggleRsiChart() {
    const show = document.getElementById('viz-toggle-rsi')?.checked;
    const container = document.getElementById('rsi-chart-container');
    if (!container) return;

    if (show) {
        container.style.display = 'block';
        renderRsiChart();
    } else {
        container.style.display = 'none';
        if (rsiChart) {
            try { rsiChart.remove(); } catch(e) {}
            rsiChart = null;
            rsiSeries = null;
        }
    }
    if (document.fullscreenElement) setTimeout(resizeChartsToFit, 50);
}

function renderRsChart() {
    const container = document.getElementById('rs-chart-container');
    if (!container) return;

    // Destroy existing
    if (rsChart) {
        try { rsChart.remove(); } catch(e) {}
        rsChart = null;
        rsSeries = null;
        rsSmaSeries = null;
    }

    const ticker = optionsAnalysisTicker;
    const isFutures = ticker && ticker.startsWith('/');

    if (isFutures) {
        container.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">RS not available for futures</div>';
        return;
    }
    if (ticker && ticker.toUpperCase() === 'SPY') {
        container.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">RS vs SPY: select a different equity</div>';
        return;
    }

    const candles = optionsVizData.candles;
    const spyCandles = optionsVizData.spyCandles;
    if (!candles || !candles.length || !spyCandles || !spyCandles.length) {
        container.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">No RS data available</div>';
        return;
    }

    const rsResult = calcRS(candles, spyCandles, 50);
    if (!rsResult.rs.length) {
        container.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">Not enough matching data for RS</div>';
        return;
    }

    container.innerHTML = '';

    rsChart = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.03)' },
            horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(224, 227, 235, 0.4)', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#363A45' },
            horzLine: { color: 'rgba(224, 227, 235, 0.4)', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#363A45' },
        },
        handleScale: { mouseWheel: false, pinch: false },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.1)',
            scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: { visible: false },
        width: container.clientWidth,
        height: 100,
    });

    rsSeries = rsChart.addLineSeries({
        color: '#06b6d4',
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
    });
    rsSeries.setData(rsResult.rs);

    if (rsResult.sma.length) {
        rsSmaSeries = rsChart.addLineSeries({
            color: '#f59e0b',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        rsSmaSeries.setData(rsResult.sma);
    }

    // Sync visible range with main chart
    if (priceChart) {
        priceChart.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
            if (rsChart && range) {
                try { rsChart.timeScale().setVisibleLogicalRange(range); } catch(e) {}
            }
        });
    }

    // Crosshair sync: main → RS and RS → main
    if (priceChart) {
        priceChart.subscribeCrosshairMove(function(param) {
            if (!rsChart || !param || !param.time) return;
            try { rsChart.setCrosshairPosition(undefined, param.time, rsSeries); } catch(e) {}
        });
        rsChart.subscribeCrosshairMove(function(param) {
            if (!priceChart || !param || !param.time) return;
            try { priceChart.setCrosshairPosition(undefined, param.time, priceSeries); } catch(e) {}
        });
    }

    // ResizeObserver
    var ro = new ResizeObserver(function() {
        if (rsChart && container.clientWidth > 0) {
            rsChart.applyOptions({ width: container.clientWidth });
        }
    });
    ro.observe(container);
}

function toggleRsChart() {
    var show = document.getElementById('viz-toggle-rs')?.checked;
    var container = document.getElementById('rs-chart-container');
    if (!container) return;

    var ticker = optionsAnalysisTicker;
    var isFutures = ticker && ticker.startsWith('/');

    // Disable for futures
    if (isFutures && show) {
        document.getElementById('viz-toggle-rs').checked = false;
        return;
    }

    if (show) {
        container.style.display = 'block';
        renderRsChart();
    } else {
        container.style.display = 'none';
        if (rsChart) {
            try { rsChart.remove(); } catch(e) {}
            rsChart = null;
            rsSeries = null;
            rsSmaSeries = null;
        }
    }
    if (document.fullscreenElement) setTimeout(resizeChartsToFit, 50);
}

// =============================================================================
// COT (Commitments of Traders) CHART
// =============================================================================
async function fetchAndRenderCotChart(ticker) {
    if (!ticker || !ticker.startsWith('/')) return;

    const url = `${API_BASE}/cot/data?ticker=${encodeURIComponent(ticker)}&weeks=104`;
    const cached = getCachedApiResponse(url);
    if (cached && cached.ok) {
        cotData = cached.data;
        renderCotChart();
        return;
    }

    try {
        const resp = await fetch(url);
        const json = await resp.json();
        cacheApiResponse(url, json);
        if (json.ok && json.data) {
            cotData = json.data;
            renderCotChart();
        } else {
            var c = document.getElementById('cot-chart-container');
            if (c) c.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">No COT data available</div>';
        }
    } catch(e) {
        console.error('COT fetch error:', e);
        var c = document.getElementById('cot-chart-container');
        if (c) c.innerHTML = '<div class="chart-loading" style="font-size:0.7rem;">Failed to load COT data</div>';
    }
}

function renderCotChart() {
    const container = document.getElementById('cot-chart-container');
    if (!container || !cotData || !cotData.series || !cotData.series.length) return;

    // Destroy existing
    if (cotChart) {
        try { cotChart.remove(); } catch(e) {}
        cotChart = null; cotCat1Series = null; cotCat2Series = null; cotCat3Series = null;
    }

    container.innerHTML = '';

    cotChart = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.03)' },
            horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(224, 227, 235, 0.4)', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#363A45' },
            horzLine: { color: 'rgba(224, 227, 235, 0.4)', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#363A45' },
        },
        handleScale: { mouseWheel: false, pinch: false },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.1)',
            autoScale: false,
            scaleMargins: { top: 0.05, bottom: 0.05 },
        },
        timeScale: { visible: false },
        width: container.clientWidth,
        height: 120,
    });

    const isTff = cotData.type === 'tff';
    const cat3Color = isTff ? '#06b6d4' : '#9ca3af';

    cotCat1Series = cotChart.addLineSeries({
        color: '#22c55e', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
    });
    cotCat2Series = cotChart.addLineSeries({
        color: '#ef4444', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
    });
    cotCat3Series = cotChart.addLineSeries({
        color: cat3Color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
    });

    const cat1Data = [], cat2Data = [], cat3Data = [];
    cotData.series.forEach(function(d) {
        const t = d.time;
        cat1Data.push({ time: t, value: d.cat1_cot_idx });
        cat2Data.push({ time: t, value: d.cat2_cot_idx });
        cat3Data.push({ time: t, value: d.cat3_cot_idx });
    });

    cotCat1Series.setData(cat1Data);
    cotCat2Series.setData(cat2Data);
    cotCat3Series.setData(cat3Data);

    // Reference lines at 80 (overbought) and 20 (oversold)
    cotCat1Series.createPriceLine({
        price: 80, color: 'rgba(239, 68, 68, 0.4)', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '',
    });
    cotCat1Series.createPriceLine({
        price: 20, color: 'rgba(34, 197, 94, 0.4)', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '',
    });

    // Legend overlay
    const labels = cotData.labels || {};
    const legend = document.createElement('div');
    legend.style.cssText = 'position:absolute;top:4px;left:8px;font-size:10px;color:#9ca3af;z-index:10;pointer-events:none;';
    legend.innerHTML = '<span style="color:#9ca3af;">COT INDEX</span> '
        + '<span style="color:#22c55e;">\u25CF ' + (labels.cat1 || 'Cat1') + '</span> '
        + '<span style="color:#ef4444;">\u25CF ' + (labels.cat2 || 'Cat2') + '</span> '
        + '<span style="color:' + cat3Color + ';">\u25CF ' + (labels.cat3 || 'Cat3') + '</span>';
    container.style.position = 'relative';
    container.appendChild(legend);

    // Sync visible range with main chart (time-based, not logical — COT has fewer weekly bars than daily price)
    // Price chart uses {year,month,day} objects; COT uses "YYYY-MM-DD" strings — must convert
    function _cotTimeRange(range) {
        if (!range || !range.from || !range.to) return null;
        function fmt(t) {
            if (typeof t === 'string') return t;
            if (t.year) return t.year + '-' + String(t.month).padStart(2,'0') + '-' + String(t.day).padStart(2,'0');
            return t;
        }
        return { from: fmt(range.from), to: fmt(range.to) };
    }
    if (priceChart) {
        priceChart.timeScale().subscribeVisibleTimeRangeChange(function(range) {
            if (cotChart && range) {
                try { cotChart.timeScale().setVisibleRange(_cotTimeRange(range)); } catch(e) {}
            }
        });
        // Initial sync
        var initRange = priceChart.timeScale().getVisibleRange();
        if (initRange) {
            try { cotChart.timeScale().setVisibleRange(_cotTimeRange(initRange)); } catch(e) {}
        }
    }

    // Crosshair sync
    if (priceChart) {
        priceChart.subscribeCrosshairMove(function(param) {
            if (!cotChart || !param || !param.time) return;
            try { cotChart.setCrosshairPosition(undefined, param.time, cotCat1Series); } catch(e) {}
        });
        cotChart.subscribeCrosshairMove(function(param) {
            if (!priceChart || !param || !param.time) return;
            try { priceChart.setCrosshairPosition(undefined, param.time, priceSeries); } catch(e) {}
        });
    }

    // ResizeObserver
    var ro = new ResizeObserver(function() {
        if (cotChart && container.clientWidth > 0) {
            cotChart.applyOptions({ width: container.clientWidth });
        }
    });
    ro.observe(container);
}

function toggleCotChart() {
    var show = document.getElementById('viz-toggle-cot')?.checked;
    var container = document.getElementById('cot-chart-container');
    if (!container) return;

    var ticker = optionsAnalysisTicker;
    var isFutures = ticker && ticker.startsWith('/');

    // Disable for non-futures
    if (!isFutures && show) {
        document.getElementById('viz-toggle-cot').checked = false;
        return;
    }

    if (show) {
        container.style.display = 'block';
        fetchAndRenderCotChart(ticker);
    } else {
        container.style.display = 'none';
        if (cotChart) {
            try { cotChart.remove(); } catch(e) {}
            cotChart = null; cotCat1Series = null; cotCat2Series = null; cotCat3Series = null; cotData = null;
        }
    }
    saveToggles();
    if (document.fullscreenElement) setTimeout(resizeChartsToFit, 50);
}

// =============================================================================
// GEX TABLE
// =============================================================================
function updateGexTable() {
    const tableBody = document.getElementById('gex-table-body');
    const countEl = document.getElementById('gex-strike-count');

    if (!tableBody) return;

    const data = optionsVizData.gexByStrike || [];

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="loading">No GEX data available</td></tr>';
        if (countEl) countEl.textContent = '-- levels';
        return;
    }

    const sortedData = [...data].sort((a, b) => b.strike - a.strike);

    tableBody.innerHTML = sortedData.map(d => {
        const netGexM = (d.netGex / 1e6).toFixed(2);
        const callGexM = (d.callGex / 1e6).toFixed(2);
        const putGexM = (d.putGex / 1e6).toFixed(2);
        const netColor = d.netGex >= 0 ? 'color: var(--green);' : 'color: var(--red);';

        return `<tr>
            <td>$${d.strike.toLocaleString()}</td>
            <td style="color: var(--green);">${callGexM}M</td>
            <td style="color: var(--red);">${putGexM}M</td>
            <td style="${netColor} font-weight: 600;">${netGexM}M</td>
            <td>${d.callOI.toLocaleString()}</td>
            <td>${d.putOI.toLocaleString()}</td>
        </tr>`;
    }).join('');

    if (countEl) countEl.textContent = `${data.length} levels`;
}

// =============================================================================
// MARKET SENTIMENT
// =============================================================================
// Cache for backend sentiment data (shared between loadMarketSentiment and updateSentimentGauge)
let _lastSentimentData = null;

async function loadMarketSentiment() {
    try {
        showSkeleton('market-sentiment-metrics', 'metrics-grid');
        const [sentimentRes, expirationsRes] = await Promise.all([
            fetch(`${API_BASE}/options/market-sentiment`),
            fetch(`${API_BASE}/options/expirations/SPY`)
        ]);

        const data = await sentimentRes.json();
        const expData = await expirationsRes.json();

        if (data.ok && data.data) {
            hideSkeleton('market-sentiment-metrics');
            const sentiment = data.data;
            _lastSentimentData = sentiment;

            // VIX
            const vix = sentiment.vix || 0;
            const vixEl = document.getElementById('vix-level');
            const oldVix = vixEl.textContent;
            vixEl.textContent = vix.toFixed(1);
            vixEl.style.color = vix > 25 ? 'var(--red)' : vix < 15 ? 'var(--green)' : 'var(--text)';
            flashValue(vixEl, vix, oldVix);
            pushSparklineValue('vix', vix);
            const vixSpark = document.getElementById('sparkline-vix');
            if (vixSpark && _sparklineData.vix) renderSparkline(vixSpark, _sparklineData.vix);
            document.getElementById('vix-label').textContent = vix > 25 ? 'High Fear' : vix < 15 ? 'Low Fear' : 'Normal';

            // VRP card
            _populateVrpCard(sentiment);
            // SKEW INDEX card
            _populateSkewCard(sentiment);
            // HY SPREAD card
            _populateHyCard(sentiment);

            // SPX Institutional Strip
            _renderSpxStrip(sentiment);

            // Update gauge with backend composite score
            updateSentimentGauge(sentiment);
        }

        const expirySelect = document.getElementById('market-sentiment-expiry');
        if (expData.ok && expData.data && expData.data.expirations) {
            const expirations = expData.data.expirations;
            expirySelect.innerHTML = formatExpirationOptions(expirations, 0);
            await loadMarketSentimentForExpiry();
        } else {
            expirySelect.innerHTML = '<option value="">N/A</option>';
        }
    } catch (e) {
        console.error('Failed to load market sentiment:', e);
    }
}

function _populateVrpCard(sentiment) {
    const vrp = sentiment.vrp;
    const el = document.getElementById('vrp-value');
    const sub = document.getElementById('vrp-label');
    if (!el) return;
    if (vrp != null) {
        el.textContent = (vrp > 0 ? '+' : '') + vrp.toFixed(1);
        el.style.color = vrp > 0 ? 'var(--green)' : 'var(--red)';
        sub.textContent = vrp > 0 ? 'IV > RV' : 'RV > IV';
    } else {
        el.textContent = '--';
        sub.textContent = 'N/A';
    }
    const card = document.getElementById('metric-card-vrp');
    if (card) card.className = 'metric-card hero-metric accent-' + (vrp > 0 ? 'green' : vrp != null ? 'red' : 'yellow');
    _updateZscorePip('zscore-pip-vrp', sentiment.factors && sentiment.factors.vrp ? sentiment.factors.vrp.zscore : null);
}

function _populateSkewCard(sentiment) {
    const skew = sentiment.skew_index;
    const el = document.getElementById('skew-value');
    const sub = document.getElementById('skew-label');
    if (!el) return;
    if (skew != null) {
        el.textContent = skew.toFixed(0);
        el.style.color = skew > 145 ? 'var(--red)' : skew > 130 ? 'var(--yellow)' : 'var(--green)';
        sub.textContent = skew > 145 ? 'Tail Hedging' : skew > 130 ? 'Elevated' : 'Normal';
    } else {
        el.textContent = '--';
        sub.textContent = 'N/A';
    }
    const card = document.getElementById('metric-card-skew');
    if (card) card.className = 'metric-card hero-metric accent-' + (skew > 145 ? 'red' : skew > 130 ? 'yellow' : 'green');
    _updateZscorePip('zscore-pip-skew', sentiment.factors && sentiment.factors.skew_idx ? sentiment.factors.skew_idx.zscore : null);
}

function _populateHyCard(sentiment) {
    const hy = sentiment.hy_oas_bps;
    const el = document.getElementById('hy-value');
    const sub = document.getElementById('hy-label');
    if (!el) return;
    if (hy != null) {
        el.textContent = hy.toFixed(0) + 'bp';
        el.style.color = hy > 600 ? 'var(--red)' : hy > 450 ? 'var(--orange)' : hy > 350 ? 'var(--yellow)' : 'var(--green)';
        sub.textContent = hy > 600 ? 'Stress' : hy > 450 ? 'Wide' : hy > 350 ? 'Normal' : 'Tight';
    } else {
        el.textContent = '--';
        sub.textContent = 'N/A';
    }
    const card = document.getElementById('metric-card-hy');
    if (card) card.className = 'metric-card hero-metric accent-' + (hy > 600 ? 'red' : hy > 450 ? 'yellow' : 'green');
    _updateZscorePip('zscore-pip-hy', sentiment.factors && sentiment.factors.hy_oas ? sentiment.factors.hy_oas.zscore : null);
}

function _toggleFactorCat(headerEl) {
    const catId = headerEl.getAttribute('data-cat');
    const rows = document.querySelector('.sf2-cat-rows[data-cat="' + catId + '"]');
    if (!rows) return;
    const isCollapsed = headerEl.classList.toggle('collapsed');
    rows.classList.toggle('collapsed', isCollapsed);
    localStorage.setItem('sf2_' + catId, isCollapsed ? '1' : '0');
}

function _updateZscorePip(id, zscore) {
    const pip = document.getElementById(id);
    if (!pip) return;
    if (zscore == null) {
        pip.style.background = 'var(--text-dim)';
        pip.classList.remove('z-extreme');
        return;
    }
    const absZ = Math.abs(zscore);
    if (absZ >= 2) {
        pip.style.background = zscore > 0 ? 'var(--red)' : 'var(--green)';
        pip.classList.add('z-extreme');
    } else if (absZ >= 1) {
        pip.style.background = zscore > 0 ? 'var(--yellow)' : 'var(--cyan)';
        pip.classList.remove('z-extreme');
    } else {
        pip.style.background = 'var(--text-dim)';
        pip.classList.remove('z-extreme');
    }
}

function _renderSpxStrip(sentiment) {
    const spx = sentiment.spx || {};
    const spxGex = spx.total_gex || 0;
    const ivRank = sentiment.spy_iv_rank;
    const ivPctl = sentiment.spy_iv_percentile;
    const skew = sentiment.spy_skew_ratio;
    const rv = sentiment.realized_vol;
    const zeroDte = sentiment.zero_dte_volume || 0;

    // SPX GEX
    const gexEl = document.getElementById('spx-gex-value');
    if (gexEl) {
        if (Math.abs(spxGex) >= 1e9) gexEl.textContent = '$' + (spxGex / 1e9).toFixed(1) + 'B';
        else if (Math.abs(spxGex) >= 1e6) gexEl.textContent = '$' + (spxGex / 1e6).toFixed(0) + 'M';
        else gexEl.textContent = spxGex === 0 ? '--' : '$' + (spxGex / 1e3).toFixed(0) + 'K';
        gexEl.style.color = spxGex > 0 ? 'var(--green)' : spxGex < 0 ? 'var(--red)' : '';
    }

    // IV Rank
    const ivEl = document.getElementById('spx-iv-rank');
    if (ivEl && ivRank != null) {
        ivEl.textContent = ivRank.toFixed(0) + '%';
        ivEl.style.color = ivRank > 80 ? 'var(--red)' : ivRank < 20 ? 'var(--green)' : 'var(--text)';
    }

    // IV Percentile
    const ivPctlEl = document.getElementById('spx-iv-pctl');
    if (ivPctlEl && ivPctl != null) {
        ivPctlEl.textContent = ivPctl.toFixed(0) + '%';
        ivPctlEl.style.color = ivPctl > 80 ? 'var(--red)' : ivPctl < 20 ? 'var(--green)' : 'var(--text)';
    }

    // Skew
    const skewEl = document.getElementById('spx-skew-ratio');
    if (skewEl && skew != null) {
        skewEl.textContent = skew.toFixed(2) + 'x';
        skewEl.style.color = skew > 1.5 ? 'var(--yellow)' : 'var(--text)';
    }

    // RV 20d
    const rvEl = document.getElementById('spx-rv-20d');
    if (rvEl) {
        if (rv != null) {
            rvEl.textContent = rv.toFixed(1) + '%';
            rvEl.style.color = rv > 25 ? 'var(--red)' : rv < 12 ? 'var(--green)' : 'var(--text)';
        } else {
            rvEl.textContent = '--';
        }
    }

    // 0DTE Volume
    const dteEl = document.getElementById('spx-0dte-vol');
    if (dteEl) {
        if (zeroDte >= 1e6) dteEl.textContent = (zeroDte / 1e6).toFixed(1) + 'M';
        else if (zeroDte >= 1e3) dteEl.textContent = (zeroDte / 1e3).toFixed(0) + 'K';
        else dteEl.textContent = zeroDte > 0 ? zeroDte.toString() : '--';
    }
}

async function loadMarketSentimentForExpiry() {
    const expiry = document.getElementById('market-sentiment-expiry').value;
    if (!expiry) return;

    if (optionsAnalysisTicker === 'SPY' && !isSyncingExpiry) {
        const oaExpirySelect = document.getElementById('oa-expiry-select');
        if (oaExpirySelect && oaExpirySelect.value !== expiry) {
            const options = Array.from(oaExpirySelect.options).map(o => o.value);
            if (options.includes(expiry)) {
                isSyncingExpiry = true;
                oaExpirySelect.value = expiry;
                loadOptionsForExpiry().finally(() => { isSyncingExpiry = false; });
            }
        }
    }

    document.getElementById('spy-pc-ratio').textContent = '...';
    document.getElementById('market-gex').textContent = '...';
    document.getElementById('spy-call-put-oi').textContent = '...';

    try {
        const [maxPainRes, gexRes] = await Promise.all([
            fetch(`${API_BASE}/options/max-pain/SPY?expiration=${expiry}`),
            fetch(`${API_BASE}/options/gex/SPY?expiration=${expiry}`)
        ]);

        const maxPainData = await maxPainRes.json();
        const gexData = await gexRes.json();

        const mp = maxPainData.data || {};
        const gex = gexData.data || {};

        const callOI = mp.total_call_oi || gex.total_call_oi || 0;
        const putOI = mp.total_put_oi || gex.total_put_oi || 0;
        const pcRatio = callOI > 0 ? (putOI / callOI) : 0;
        const pcEl = document.getElementById('spy-pc-ratio');
        const oldPc = pcEl.textContent;
        pcEl.textContent = pcRatio.toFixed(2);
        pcEl.style.color = pcRatio > 1.0 ? 'var(--red)' : pcRatio < 0.7 ? 'var(--green)' : 'var(--text)';
        flashValue(pcEl, pcRatio, oldPc);
        pushSparklineValue('pc-ratio', pcRatio);
        const pcSpark = document.getElementById('sparkline-pc-ratio');
        if (pcSpark && _sparklineData['pc-ratio']) renderSparkline(pcSpark, _sparklineData['pc-ratio']);
        document.getElementById('spy-pc-label').textContent = pcRatio > 1.0 ? 'Bearish' : pcRatio < 0.7 ? 'Bullish' : 'Neutral';

        const oiEl = document.getElementById('spy-call-put-oi');
        if (oiEl) {
            oiEl.innerHTML = `<span style="color: var(--green);">${(callOI/1000).toFixed(0)}K</span>/<span style="color: var(--red);">${(putOI/1000).toFixed(0)}K</span>`;
        }

        let gexValue = gex.total_gex || 0;
        if (typeof gexValue === 'object') gexValue = gexValue.total || 0;
        const gexEl = document.getElementById('market-gex');
        if (Math.abs(gexValue) >= 1e9) {
            gexEl.textContent = '$' + (gexValue / 1e9).toFixed(1) + 'B';
        } else if (Math.abs(gexValue) >= 1e6) {
            gexEl.textContent = '$' + (gexValue / 1e6).toFixed(1) + 'M';
        } else {
            gexEl.textContent = '$' + (gexValue / 1e3).toFixed(0) + 'K';
        }
        gexEl.style.color = gexValue > 0 ? 'var(--green)' : 'var(--red)';
        pushSparklineValue('gex', gexValue);
        const gexSpark = document.getElementById('sparkline-gex');
        if (gexSpark && _sparklineData.gex) renderSparkline(gexSpark, _sparklineData.gex);
        document.getElementById('gex-label').textContent = gexValue > 0 ? 'Stabilizing' : 'Volatile';

        // Max Pain — moved to SPX strip
        const maxPain = mp.max_pain_price || 0;
        const spxMpEl = document.getElementById('spx-max-pain');
        if (spxMpEl) {
            spxMpEl.textContent = maxPain > 0 ? '$' + maxPain.toFixed(0) : '--';
            const dist = mp.distance_pct || 0;
            spxMpEl.style.color = Math.abs(dist) < 2 ? 'var(--green)' : Math.abs(dist) < 5 ? 'var(--yellow)' : 'var(--text)';
        }

        // Update gauge: merge expiry-specific data into cached sentiment
        if (_lastSentimentData) {
            _lastSentimentData._spyGex = gexValue;
            _lastSentimentData._spyPcRatio = pcRatio;
            updateSentimentGauge(_lastSentimentData);
        }

    } catch (e) {
        console.error('Failed to load sentiment for expiry:', e);
    }
}

// =============================================================================
// SENTIMENT GAUGE (uses backend composite score + factor breakdown)
// =============================================================================

function _formatFactorRaw(key, raw) {
    if (raw == null) return '--';
    if (key === 'spx_gex') {
        if (Math.abs(raw) >= 1e9) return '$' + (raw / 1e9).toFixed(1) + 'B';
        if (Math.abs(raw) >= 1e6) return '$' + (raw / 1e6).toFixed(0) + 'M';
        return raw === 0 ? '--' : '$' + (raw / 1e3).toFixed(0) + 'K';
    }
    if (key === 'vix') return raw.toFixed(1);
    if (key === 'spy_pc' || key === 'spy_skew') return raw.toFixed(2);
    if (key === 'vix_ts') return raw.toFixed(3);
    if (key === 'vrp') return (raw > 0 ? '+' : '') + raw.toFixed(1);
    if (key === 'skew_idx') return raw.toFixed(0);
    if (key === 'hy_oas') return raw.toFixed(0) + 'bp';
    return typeof raw === 'number' ? raw.toFixed(2) : String(raw);
}

function _renderConfBar(id, valId, value) {
    const bar = document.getElementById(id);
    const val = document.getElementById(valId);
    if (!bar || !val) return;
    const v = Math.max(0, Math.min(100, value || 0));
    bar.style.width = v + '%';
    val.textContent = Math.round(v) + '%';
    if (v >= 70) { bar.style.background = 'var(--green)'; val.style.color = 'var(--green)'; }
    else if (v >= 40) { bar.style.background = 'var(--yellow)'; val.style.color = 'var(--yellow)'; }
    else { bar.style.background = 'var(--text-dim)'; val.style.color = 'var(--text-dim)'; }
}

function updateSentimentGauge(sentiment) {
    const score = sentiment.market_sentiment_score || 50;
    const label_text = sentiment.market_label || 'Neutral';
    const confidence = sentiment.confidence || 0;
    const factors = sentiment.factors || {};
    const vix = sentiment.vix || 20;

    // Needle — SVG coordinates for 220x125 viewbox: pivot at 110,105, radius 88
    const angle = -90 + (score / 100) * 180;
    const needle = document.getElementById('sentiment-needle');
    if (needle) needle.setAttribute('transform', 'rotate(' + angle + ', 110, 105)');

    // Score text in SVG
    const scoreText = document.getElementById('sentiment-score-text');
    if (scoreText) scoreText.textContent = Math.round(score);

    // Confidence badge
    const confEl = document.getElementById('sentiment-confidence');
    if (confEl) {
        confEl.textContent = Math.round(confidence) + '% conf';
        confEl.style.color = confidence >= 60 ? 'var(--green)' : confidence >= 30 ? 'var(--text-muted)' : 'var(--text-dim)';
    }

    // Confidence decomposition bars
    _renderConfBar('conf-bar-agr', 'conf-val-agr', sentiment.confidence_agreement);
    _renderConfBar('conf-bar-str', 'conf-val-str', sentiment.confidence_strength);
    _renderConfBar('conf-bar-dir', 'conf-val-dir', sentiment.confidence_directionality);

    // Glow
    const glow = document.getElementById('sentiment-glow');
    if (glow) {
        const glowColor = score >= 65 ? 'rgba(34,197,94,0.15)' : score >= 40 ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.15)';
        glow.style.background = 'radial-gradient(ellipse, ' + glowColor + ' 0%, transparent 70%)';
    }

    // Label + description
    const labelEl = document.getElementById('sentiment-label');
    const description = document.getElementById('sentiment-description');
    const labelColor = score >= 60 ? 'var(--green)' : score >= 40 ? 'var(--text)' : 'var(--red)';
    if (labelEl) { labelEl.textContent = label_text.toUpperCase(); labelEl.style.color = labelColor; }

    if (description) {
        const sortedFactors = Object.values(factors).sort((a, b) => Math.abs(b.signal * b.weight) - Math.abs(a.signal * a.weight));
        const dominant = sortedFactors[0];
        if (dominant) {
            const dir = dominant.signal > 0 ? 'bullish' : dominant.signal < 0 ? 'bearish' : 'neutral';
            description.textContent = dominant.label + ' is ' + dir + ' (strongest signal)';
        } else {
            description.textContent = '8-factor z-score composite';
        }
    }

    // Categorized factor bars
    const factorsEl = document.getElementById('sentiment-factors');
    if (factorsEl) {
        const CAT_ORDER = ['Volatility', 'Flow', 'Credit'];
        const CAT_COLORS = { Volatility: 'cat-volatility', Flow: 'cat-flow', Credit: 'cat-credit' };
        const CAT_DOT_COLORS = { Volatility: 'var(--cyan)', Flow: 'var(--green)', Credit: 'var(--orange)' };

        // Group factors by category
        const grouped = {};
        for (const [key, f] of Object.entries(factors)) {
            const cat = f.category || 'Other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push([key, f]);
        }

        let html = '';
        for (const cat of CAT_ORDER) {
            const items = grouped[cat];
            if (!items || items.length === 0) continue;
            const pipCls = CAT_COLORS[cat] || '';
            const catId = cat.toLowerCase();

            // Compute category summary: weighted avg signal
            let catSignalSum = 0, catWeightSum = 0;
            for (const [, f] of items) {
                catSignalSum += (f.signal || 0) * (f.weight || 0);
                catWeightSum += (f.weight || 0);
            }
            const catAvgSignal = catWeightSum > 0 ? catSignalSum / catWeightSum : 0;
            const catColor = catAvgSignal > 0 ? 'var(--green)' : catAvgSignal < 0 ? 'var(--red)' : 'var(--text-dim)';
            const catBarW = Math.abs(catAvgSignal) * 50;
            const catBarCls = catAvgSignal >= 0 ? 'bullish' : 'bearish';
            const catLabel = catAvgSignal > 0.3 ? 'Bullish' : catAvgSignal > 0.1 ? 'Lean Bull' : catAvgSignal < -0.3 ? 'Bearish' : catAvgSignal < -0.1 ? 'Lean Bear' : 'Neutral';

            // Check localStorage for collapsed state
            const isCollapsed = localStorage.getItem('sf2_' + catId) === '1';
            html += '<div class="sf2-cat-header' + (isCollapsed ? ' collapsed' : '') + '" data-cat="' + catId + '" onclick="_toggleFactorCat(this)">' +
                '<span class="sf2-cat-arrow">&#9662;</span>' +
                '<span class="sf2-cat-pip ' + pipCls + '"></span>' +
                '<span class="sf2-cat-label">' + cat.toUpperCase() + '</span>' +
                '<span class="sf2-cat-line"></span>' +
                '<span class="sf2-cat-summary">' +
                    '<span class="sf2-cat-signal" style="color:' + catColor + '">' + catLabel + ' ' + (catAvgSignal > 0 ? '+' : '') + catAvgSignal.toFixed(2) + '</span>' +
                    '<span class="sf2-cat-mini-bar"><span class="sf2-cat-mini-fill ' + catBarCls + '" style="width:' + catBarW + '%"></span></span>' +
                '</span>' +
            '</div>';

            html += '<div class="sf2-cat-rows' + (isCollapsed ? ' collapsed' : '') + '" data-cat="' + catId + '">';
            for (const [key, f] of items) {
                const signal = f.signal || 0;
                const weightPct = Math.round(f.weight * 100);
                const barWidth = Math.abs(signal) * 50;
                const cls = signal >= 0 ? 'bullish' : 'bearish';
                const color = signal > 0 ? 'var(--green)' : signal < 0 ? 'var(--red)' : 'var(--text-dim)';
                const dotColor = CAT_DOT_COLORS[cat] || 'var(--text-dim)';

                // Z-score display
                let zFmt = '--';
                let zColor = 'var(--text-dim)';
                if (f.zscore != null) {
                    const absZ = Math.abs(f.zscore);
                    zFmt = 'z' + (f.zscore >= 0 ? '+' : '') + f.zscore.toFixed(1);
                    if (absZ >= 2) zColor = f.zscore > 0 ? 'var(--red)' : 'var(--green)';
                    else if (absZ >= 1) zColor = 'var(--yellow)';
                }

                html += '<div class="sf2-row" title="' + f.label + ': ' + _formatFactorRaw(key, f.raw) + '">' +
                    '<span class="sf2-cat-dot" style="background:' + dotColor + '"></span>' +
                    '<span class="sf2-label">' + f.label + '</span>' +
                    '<span class="sf2-weight">' + weightPct + '%</span>' +
                    '<div class="sf2-bar-track"><div class="sf2-bar-fill ' + cls + '" style="width:' + barWidth + '%;"></div></div>' +
                    '<span class="sf2-zscore" style="color:' + zColor + '">' + zFmt + '</span>' +
                    '<span class="sf2-signal" style="color:' + color + '">' + (signal > 0 ? '+' : '') + signal.toFixed(2) + '</span>' +
                '</div>';
            }
            html += '</div>';
        }
        factorsEl.innerHTML = html;
    }

    // Metric card accents
    const pcRatio = sentiment._spyPcRatio || sentiment.spy_put_call_ratio || sentiment.put_call_ratio || 1.0;
    const gexValue = sentiment._spyGex != null ? sentiment._spyGex : sentiment.total_gex || 0;

    const vixCard = document.getElementById('metric-card-vix');
    if (vixCard) vixCard.className = 'metric-card hero-metric accent-' + (vix > 25 ? 'red' : vix < 15 ? 'green' : 'yellow');
    const pcCard = document.getElementById('metric-card-pc');
    if (pcCard) pcCard.className = 'metric-card hero-metric accent-' + (pcRatio > 1.0 ? 'red' : pcRatio < 0.7 ? 'green' : 'yellow');
    const gexCard = document.getElementById('metric-card-gex');
    if (gexCard) gexCard.className = 'metric-card hero-metric accent-' + (typeof gexValue === 'number' && gexValue > 0 ? 'green' : 'red');
}


// =============================================================================
// SHOW OPTIONS CHART (MAX PAIN / GEX TOGGLE)
// =============================================================================
function showOptionsChart(chartType) {
    activeOptionsChart = chartType;

    const gexCard = document.getElementById('oa-gex-card');
    const maxpainCard = document.getElementById('oa-maxpain-card');

    if (chartType === 'gex') {
        if (gexCard) gexCard.style.border = '2px solid var(--green)';
        if (maxpainCard) maxpainCard.style.border = '2px solid transparent';
        document.getElementById('oa-chart-title').textContent = 'Gamma Exposure (GEX) by Strike';
        renderGexChart(optionsChartData.gexByStrike, optionsChartData.currentPrice);
    } else {
        if (gexCard) gexCard.style.border = '2px solid transparent';
        if (maxpainCard) maxpainCard.style.border = '2px solid var(--purple)';
        document.getElementById('oa-chart-title').textContent = 'Pain by Strike Price';
        renderPainChart(optionsChartData.painByStrike, optionsChartData.maxPainPrice, optionsChartData.currentPrice);
    }
}

// =============================================================================
// RENDER PAIN CHART (INLINE BAR CHART)
// =============================================================================
function renderPainChart(painByStrike, maxPainPrice, currentPrice) {
    const chartDiv = document.getElementById('oa-chart');

    if (!painByStrike || painByStrike.length === 0) {
        chartDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 40px;">No pain data available</div>';
        return;
    }

    let data = painByStrike.slice();
    if (currentPrice > 0 && data.length > 20) {
        const minRange = currentPrice * 0.85;
        const maxRange = currentPrice * 1.15;
        const filtered = data.filter(d => d.strike >= minRange && d.strike <= maxRange);
        if (filtered.length >= 5) data = filtered;
    }

    if (data.length > 20) {
        const maxPainIdx = data.findIndex(d => Math.abs(d.strike - maxPainPrice) < 0.01);
        const centerIdx = maxPainIdx >= 0 ? maxPainIdx : Math.floor(data.length / 2);
        const start = Math.max(0, centerIdx - 10);
        const end = Math.min(data.length, centerIdx + 10);
        data = data.slice(start, end);
    }

    if (data.length === 0) {
        chartDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 40px;">No data in range</div>';
        return;
    }

    const pains = data.map(d => d.pain);
    const maxPain = Math.max(...pains);
    const minPain = Math.min(...pains);
    const painRange = maxPain - minPain || 1;

    const strikes = data.map(d => d.strike);
    const minStrike = Math.min(...strikes);
    const maxStrike = Math.max(...strikes);
    const currentPricePos = currentPrice >= minStrike && currentPrice <= maxStrike
        ? ((currentPrice - minStrike) / (maxStrike - minStrike)) * 100 : -1;

    const chartHeight = 120;
    let html = '<div style="display: flex; align-items: flex-end; gap: 1px; height: ' + chartHeight + 'px; position: relative; padding: 0 10px;">';

    if (currentPricePos >= 0) {
        html += `<div style="position: absolute; left: calc(10px + ${currentPricePos}% * 0.95); top: 0; bottom: 0; width: 2px; background: var(--blue); z-index: 10;"></div>`;
        html += `<div style="position: absolute; left: calc(${currentPricePos}% * 0.95 - 10px); top: -16px; font-size: 10px; color: var(--blue); width: 50px; text-align: center;">$${currentPrice.toFixed(0)}</div>`;
    }

    data.forEach(d => {
        const heightPct = (d.pain - minPain) / painRange;
        const barHeight = Math.max(Math.round(heightPct * chartHeight), 3);
        const isMaxPain = Math.abs(d.strike - maxPainPrice) < 0.01;
        const barColor = isMaxPain ? '#a855f7' : 'rgba(100, 116, 139, 0.6)';
        const barStyle = isMaxPain ? 'box-shadow: 0 0 8px #a855f7;' : '';
        html += `<div style="flex: 1; height: ${barHeight}px; background: ${barColor}; border-radius: 2px 2px 0 0; min-width: 4px; ${barStyle}" title="$${d.strike}: ${(d.pain/1e6).toFixed(1)}M pain"></div>`;
    });
    html += '</div>';

    html += '<div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 9px; color: var(--text-muted);">';
    const step = Math.max(1, Math.floor(data.length / 5));
    for (let i = 0; i < data.length; i += step) {
        const d = data[i];
        const isMP = Math.abs(d.strike - maxPainPrice) < 0.01;
        html += `<span style="${isMP ? 'color: var(--purple); font-weight: 600;' : ''}">$${d.strike}</span>`;
    }
    if (data.length > 1) {
        const last = data[data.length - 1];
        const isMP = Math.abs(last.strike - maxPainPrice) < 0.01;
        html += `<span style="${isMP ? 'color: var(--purple); font-weight: 600;' : ''}">$${last.strike}</span>`;
    }
    html += '</div>';

    chartDiv.innerHTML = html;
}

// =============================================================================
// RENDER GEX CHART (INLINE BAR CHART - BIDIRECTIONAL)
// =============================================================================
function renderGexChart(gexByStrike, currentPrice) {
    const chartDiv = document.getElementById('oa-chart');

    if (!gexByStrike || gexByStrike.length === 0) {
        chartDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 40px;">No GEX data available</div>';
        return;
    }

    let data = gexByStrike.slice();
    if (currentPrice > 0 && data.length > 20) {
        const minRange = currentPrice * 0.85;
        const maxRange = currentPrice * 1.15;
        const filtered = data.filter(d => d.strike >= minRange && d.strike <= maxRange);
        if (filtered.length >= 5) data = filtered;
    }

    if (data.length > 20) {
        const centerIdx = data.findIndex(d => d.strike >= currentPrice) || Math.floor(data.length / 2);
        const start = Math.max(0, centerIdx - 10);
        const end = Math.min(data.length, centerIdx + 10);
        data = data.slice(start, end);
    }

    if (data.length === 0) {
        chartDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 40px;">No data in range</div>';
        return;
    }

    const gexValues = data.map(d => d.netGex);
    const maxAbsGex = Math.max(...gexValues.map(Math.abs)) || 1;

    const strikes = data.map(d => d.strike);
    const minStrike = Math.min(...strikes);
    const maxStrike = Math.max(...strikes);
    const currentPricePos = currentPrice >= minStrike && currentPrice <= maxStrike
        ? ((currentPrice - minStrike) / (maxStrike - minStrike)) * 100 : -1;

    const chartHeight = 120;
    const halfHeight = chartHeight / 2;

    let html = '<div style="display: flex; align-items: center; gap: 1px; height: ' + chartHeight + 'px; position: relative; padding: 0 10px;">';

    html += `<div style="position: absolute; left: 10px; right: 10px; top: ${halfHeight}px; height: 1px; background: var(--border); z-index: 5;"></div>`;

    if (currentPricePos >= 0) {
        html += `<div style="position: absolute; left: calc(10px + ${currentPricePos}% * 0.95); top: 0; bottom: 0; width: 2px; background: var(--blue); z-index: 10;"></div>`;
        html += `<div style="position: absolute; left: calc(${currentPricePos}% * 0.95 - 10px); top: -16px; font-size: 10px; color: var(--blue); width: 50px; text-align: center;">$${currentPrice.toFixed(0)}</div>`;
    }

    data.forEach(d => {
        const gexPct = d.netGex / maxAbsGex;
        const barHeight = Math.abs(gexPct) * halfHeight;
        const isPositive = d.netGex >= 0;
        const barColor = isPositive ? 'var(--green)' : 'var(--red)';

        const barStyle = isPositive
            ? `height: ${barHeight}px; margin-bottom: ${halfHeight}px;`
            : `height: ${barHeight}px; margin-top: ${halfHeight}px;`;

        const gexK = (d.netGex / 1000).toFixed(0);
        html += `<div style="flex: 1; display: flex; align-items: ${isPositive ? 'flex-end' : 'flex-start'}; min-width: 4px;">
            <div style="width: 100%; ${barStyle} background: ${barColor}; border-radius: ${isPositive ? '2px 2px 0 0' : '0 0 2px 2px'}; opacity: 0.8;" title="$${d.strike}: ${gexK}K GEX"></div>
        </div>`;
    });
    html += '</div>';

    html += '<div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 9px; color: var(--text-muted);">';
    const step = Math.max(1, Math.floor(data.length / 5));
    for (let i = 0; i < data.length; i += step) {
        html += `<span>$${data[i].strike}</span>`;
    }
    if (data.length > 1) {
        html += `<span>$${data[data.length - 1].strike}</span>`;
    }
    html += '</div>';

    chartDiv.innerHTML = html;
}


// =============================================================================
// TAB SWITCHING
// =============================================================================
function showTab(tabId) {
    // Migrate old tab IDs from removed tabs
    const tabMigration = {
        'tab-gex': 'tab-analysis',
        'tab-strategy': 'tab-trade',
        'tab-chain-flow': 'tab-trade',
        'tab-backtest': 'tab-trade',
        'tab-trading': 'tab-trade'
    };
    if (tabMigration[tabId]) tabId = tabMigration[tabId];

    activeTab = tabId;
    localStorage.setItem('gq_tab', tabId);

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.classList.add('active');

    // Re-render charts that were created while tab was hidden (0 dimensions)
    if (tabId === 'tab-chart') {
        // Ensure viz container is visible if a ticker is selected
        const vizContainer = document.getElementById('options-viz-container');
        if (vizContainer && optionsAnalysisTicker) {
            vizContainer.style.display = 'block';
        }
        setTimeout(() => {
            renderPriceChart();
            renderVizGexChart();
        }, 50);
    }
    if (tabId === 'tab-analysis' && ivSmileChart) {
        setTimeout(() => {
            try { ivSmileChart.updateOptions({ chart: { width: document.getElementById('iv-smile-chart')?.clientWidth } }); } catch(e) {}
        }, 50);
    }
    if (tabId === 'tab-trade') {
        loadTradingDashboard();
        startTradingRefresh();
    } else {
        stopTradingRefresh();
    }
}

// =============================================================================
// EXPECTED MOVE
// =============================================================================
function computeExpectedMove(price, iv, dte) {
    if (!price || !iv || !dte || dte <= 0) return null;
    const ivDecimal = iv > 1 ? iv / 100 : iv;
    const timeFactor = Math.sqrt(dte / 365);
    const sd1 = price * ivDecimal * timeFactor;
    const sd15 = sd1 * 1.5;
    const sd2 = sd1 * 2;
    return {
        sd1Upper: price + sd1,
        sd1Lower: price - sd1,
        sd15Upper: price + sd15,
        sd15Lower: price - sd15,
        sd2Upper: price + sd2,
        sd2Lower: price - sd2,
        sd1Amount: sd1
    };
}

function renderExpectedMove(price, iv, dte) {
    const card = document.getElementById('expected-move-card');
    if (!card) return;

    const em = computeExpectedMove(price, iv, dte);
    if (!em) {
        card.style.display = 'none';
        return;
    }

    card.style.display = 'block';

    // Update DTE badge
    document.getElementById('em-dte-badge').textContent = `${dte} DTE | IV: ${(iv > 1 ? iv : iv * 100).toFixed(1)}%`;

    // Update price levels
    document.getElementById('em-sd2-lower').textContent = `$${em.sd2Lower.toFixed(2)}`;
    document.getElementById('em-sd1-lower').textContent = `$${em.sd1Lower.toFixed(2)}`;
    document.getElementById('em-current').textContent = `$${price.toFixed(2)}`;
    document.getElementById('em-sd1-upper').textContent = `$${em.sd1Upper.toFixed(2)}`;
    document.getElementById('em-sd2-upper').textContent = `$${em.sd2Upper.toFixed(2)}`;

    // Render range bars
    const container = document.getElementById('em-range-container');
    const totalRange = em.sd2Upper - em.sd2Lower;
    const toPercent = (val) => ((val - em.sd2Lower) / totalRange) * 100;

    const sd2Left = 0;
    const sd2Width = 100;
    const sd15Left = toPercent(em.sd15Lower);
    const sd15Width = toPercent(em.sd15Upper) - sd15Left;
    const sd1Left = toPercent(em.sd1Lower);
    const sd1Width = toPercent(em.sd1Upper) - sd1Left;
    const currentPos = toPercent(price);

    container.innerHTML = `
        <div class="em-range-bar sd2" style="left: ${sd2Left}%; width: ${sd2Width}%;"></div>
        <div class="em-range-bar sd15" style="left: ${sd15Left}%; width: ${sd15Width}%;"></div>
        <div class="em-range-bar sd1" style="left: ${sd1Left}%; width: ${sd1Width}%;"></div>
        <div class="em-current-marker" style="left: ${currentPos}%;"></div>
    `;
}

// =============================================================================
// IV SMILE / SKEW CHART
// =============================================================================
function renderIVSmile(calls, puts, currentPrice) {
    const container = document.getElementById('iv-smile-container');
    const chartDiv = document.getElementById('iv-smile-chart');
    if (!container || !chartDiv) return;

    // Extract IV data from calls and puts
    const callIVData = [];
    const putIVData = [];

    if (calls && calls.length > 0) {
        calls.forEach(c => {
            if (c.strike && c.implied_volatility && c.implied_volatility > 0) {
                callIVData.push({ x: c.strike, y: parseFloat((c.implied_volatility * 100).toFixed(1)) });
            }
        });
    }

    if (puts && puts.length > 0) {
        puts.forEach(p => {
            if (p.strike && p.implied_volatility && p.implied_volatility > 0) {
                putIVData.push({ x: p.strike, y: parseFloat((p.implied_volatility * 100).toFixed(1)) });
            }
        });
    }

    if (callIVData.length < 3 && putIVData.length < 3) {
        container.style.display = 'none';
        return;
    }

    // Filter to strikes near ATM (±15% of current price)
    const filterNearATM = (data) => {
        if (!currentPrice || currentPrice <= 0) return data;
        const low = currentPrice * 0.85;
        const high = currentPrice * 1.15;
        return data.filter(d => d.x >= low && d.x <= high);
    };

    const filteredCalls = filterNearATM(callIVData).sort((a, b) => a.x - b.x);
    const filteredPuts = filterNearATM(putIVData).sort((a, b) => a.x - b.x);

    if (filteredCalls.length < 2 && filteredPuts.length < 2) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    const xAxisAnnotations = [];
    if (currentPrice > 0) {
        xAxisAnnotations.push({
            x: currentPrice,
            borderColor: '#ffffff',
            borderWidth: 2,
            label: {
                text: `ATM: $${currentPrice.toFixed(0)}`,
                style: { color: '#fff', background: 'rgba(0,0,0,0.7)', fontSize: '10px' },
                position: 'top'
            }
        });
    }

    const series = [];
    if (filteredCalls.length >= 2) {
        series.push({ name: 'Call IV', data: filteredCalls });
    }
    if (filteredPuts.length >= 2) {
        series.push({ name: 'Put IV', data: filteredPuts });
    }

    const colors = [];
    if (filteredCalls.length >= 2) colors.push('#22c55e');
    if (filteredPuts.length >= 2) colors.push('#ef4444');

    const options = {
        chart: {
            type: 'line',
            height: 200,
            background: 'transparent',
            toolbar: { show: false },
            animations: { enabled: true, speed: 400 }
        },
        theme: { mode: 'dark' },
        series: series,
        colors: colors,
        stroke: { width: 2, curve: 'smooth' },
        xaxis: {
            type: 'numeric',
            labels: {
                formatter: val => `$${parseFloat(val).toFixed(0)}`,
                style: { colors: '#71717a', fontSize: '10px' }
            },
            title: { text: 'Strike Price', style: { color: '#71717a', fontSize: '11px' } }
        },
        yaxis: {
            labels: {
                formatter: val => `${val.toFixed(0)}%`,
                style: { colors: '#71717a', fontSize: '10px' }
            },
            title: { text: 'Implied Volatility', style: { color: '#71717a', fontSize: '11px' } }
        },
        tooltip: {
            theme: 'dark',
            x: { formatter: val => `Strike: $${parseFloat(val).toFixed(0)}` },
            y: { formatter: val => `${val.toFixed(1)}%` }
        },
        legend: {
            show: true,
            position: 'top',
            labels: { colors: '#9ca3af' },
            fontSize: '11px'
        },
        grid: { borderColor: '#2a2a3a', strokeDashArray: 3 },
        annotations: { xaxis: xAxisAnnotations }
    };

    if (ivSmileChart) {
        ivSmileChart.destroy();
        ivSmileChart = null;
    }

    ivSmileChart = new ApexCharts(chartDiv, options);
    ivSmileChart.render();
}

// =============================================================================
// SWING TRADE TRACKER
// =============================================================================

const SWING_STORAGE_KEY = 'gq_swing_trades';
let _swingRefreshTimer = null;

function getSwingTrades() {
    try {
        return JSON.parse(localStorage.getItem(SWING_STORAGE_KEY) || '[]');
    } catch { return []; }
}

function saveSwingTrades(trades) {
    localStorage.setItem(SWING_STORAGE_KEY, JSON.stringify(trades));
}

function trackTradeIdea(idx) {
    const ideas = window._lastTradeIdeas;
    const xray = window._lastXrayData;
    if (!ideas || !ideas[idx] || !xray) return;

    const idea = ideas[idx];
    const ticker = xray.ticker;

    // Parse strike, type, premium from action text: "Buy $600 call @ $5.20 | ..."
    const m = idea.action.match(/Buy \$([0-9,.]+)\s+(call|put)\s+@\s+\$([0-9.]+)/i);
    if (!m) { console.warn('Could not parse trade action:', idea.action); return; }

    const strike = parseFloat(m[1].replace(',', ''));
    const optType = m[2].toLowerCase();
    const premium = parseFloat(m[3]);
    // For multi-DTE ideas, use per-idea expiration; for swing, use swing_metrics; otherwise base xray
    const expiration = idea._expiration || (idea.swing_mode && idea.swing_metrics?.expiration) || xray.expiration;

    // Duplicate check
    const trades = getSwingTrades();
    const dup = trades.find(t => t.ticker === ticker && t.strike === strike &&
        t.opt_type === optType && t.expiration === expiration);
    if (dup) {
        const btn = document.querySelector(`.trade-idea-card[data-idx="${idx}"] .trade-idea-track-btn`);
        if (btn) { btn.textContent = 'Tracked'; btn.classList.add('tracked'); }
        showToast('Already tracked: ' + ticker + ' $' + strike + ' ' + optType, 'warning');
        return;
    }

    // Build entry snapshot
    const composite = xray.composite || {};
    const smartMoney = xray.smart_money || {};
    const tradeZones = xray.trade_zones || {};
    const squeeze = xray.squeeze_pin || {};
    const volSurface = xray.vol_surface || {};

    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ticker,
        strike,
        opt_type: optType,
        entry_premium: premium,
        expiration,
        entry_date: new Date().toISOString().slice(0, 10),
        entry_price: xray.current_price,
        entry_composite_score: composite.score,
        entry_composite_label: composite.label,
        entry_net_flow: smartMoney.net_flow,
        entry_gex_regime: null, // from dealer flow
        entry_support: tradeZones.support,
        entry_resistance: tradeZones.resistance,
        entry_atm_iv: volSurface.atm_iv,
        entry_squeeze_score: squeeze.squeeze_score,
        idea_title: idea.title,
        swing_mode: idea.swing_mode || false,
        swing_metrics: idea.swing_metrics || null,
        last_analysis: null
    };

    // Try to get GEX regime from dealer flow levels
    if (xray.dealer_flow && xray.dealer_flow.levels) {
        const cp = xray.current_price;
        const closest = xray.dealer_flow.levels.reduce((best, l) =>
            Math.abs(l.price - cp) < Math.abs((best?.price || Infinity) - cp) ? l : best, null);
        if (closest) entry.entry_gex_regime = closest.regime;
    }

    trades.push(entry);
    saveSwingTrades(trades);

    // Update button
    const btn = document.querySelector(`.trade-idea-card[data-idx="${idx}"] .trade-idea-track-btn`);
    if (btn) { btn.textContent = 'Tracked'; btn.classList.add('tracked'); }
    showToast('Trade tracked: ' + ticker + ' $' + strike + ' ' + optType, 'success');

    // Trigger analysis
    refreshSwingTrades();
}

async function refreshSwingTrades() {
    const trades = getSwingTrades();
    if (!trades.length) {
        renderSwingTrades();
        return;
    }

    const btn = document.getElementById('swing-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }

    try {
        const payload = trades.map(t => ({
            ticker: t.ticker,
            strike: t.strike,
            opt_type: t.opt_type,
            entry_premium: t.entry_premium,
            expiration: t.expiration,
            entry_date: t.entry_date,
            entry_composite_score: t.entry_composite_score,
            entry_composite_label: t.entry_composite_label,
            entry_net_flow: t.entry_net_flow,
            entry_gex_regime: t.entry_gex_regime,
            entry_support: t.entry_support,
            entry_resistance: t.entry_resistance,
            entry_atm_iv: t.entry_atm_iv,
            entry_squeeze_score: t.entry_squeeze_score,
        }));

        const resp = await fetch(`${API_BASE}/options/swing-trade/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trades: payload })
        });
        const json = await resp.json();

        if (json.ok && json.data && json.data.trades) {
            const results = json.data.trades;
            // Attach analysis to stored trades
            for (let i = 0; i < trades.length && i < results.length; i++) {
                trades[i].last_analysis = results[i];
                trades[i].last_refresh = new Date().toISOString();
            }
            saveSwingTrades(trades);
        }
    } catch (e) {
        console.error('Swing trade refresh error:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Refresh All'; }
    }

    renderSwingTrades();
}

function renderSwingTrades() {
    const container = document.getElementById('swing-trades-container');
    const list = document.getElementById('swing-trades-list');
    const countEl = document.getElementById('swing-trade-count');
    const refreshEl = document.getElementById('swing-last-refresh');
    if (!container || !list) return;

    const trades = getSwingTrades();
    if (!trades.length) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    if (countEl) countEl.textContent = trades.length;

    // Last refresh time
    const lastRefresh = trades.find(t => t.last_refresh)?.last_refresh;
    if (refreshEl && lastRefresh) {
        const d = new Date(lastRefresh);
        refreshEl.textContent = `Updated ${d.toLocaleTimeString()}`;
    }

    const cards = trades.map((trade, i) => {
        const a = trade.last_analysis;
        if (!a || a.error) {
            return renderSwingCardError(trade, i, a);
        }
        return renderSwingCard(trade, i, a);
    }).join('');

    list.innerHTML = cards;
}

function renderSwingCardError(trade, idx, analysis) {
    const signal = analysis?.signal || 'MANUAL CHECK';
    const signalClass = 'signal-manual-check';
    return `<div class="swing-trade-card ${signalClass}">
        <div class="swing-header">
            <div class="swing-header-left">
                <span class="swing-ticker">${trade.ticker}</span>
                <span class="swing-strike-info">$${trade.strike} ${trade.opt_type.toUpperCase()} | ${trade.expiration}</span>
            </div>
            <span style="color:var(--text-muted);font-size:0.8rem;">${signal} — ${analysis?.error || 'No data'}</span>
        </div>
        <div class="swing-footer">
            <button onclick="refreshSwingTrades()">Re-analyze</button>
            <button class="close-trade" onclick="closeSwingTrade(${idx})">Close Trade</button>
        </div>
    </div>`;
}

function renderSwingCard(trade, idx, a) {
    const hold = a.hold || {};
    const pnl = a.pnl || {};
    const regime = a.regime || {};
    const thetaBurn = a.theta_burn || {};
    const greeks = a.greeks || {};
    const ivMon = a.iv_monitor || {};
    const signal = a.signal || '';

    // Signal class
    const labelMap = {
        'STRONG HOLD': 'strong-hold', 'HOLD': 'hold', 'MONITOR': 'monitor',
        'REDUCE': 'reduce', 'EXIT': 'exit'
    };
    const holdClass = labelMap[hold.label] || 'monitor';

    // P&L badge
    const pnlPct = pnl.pnl_percent || 0;
    const pnlClass = pnlPct > 0 ? 'positive' : pnlPct < 0 ? 'negative' : 'neutral';

    // Factor bars
    const factorNames = {
        'pnl_momentum': 'P&L', 'time_decay': 'Time', 'regime_alignment': 'Regime',
        'level_integrity': 'Levels', 'iv_trend': 'IV', 'smart_money': 'Flow',
        'squeeze_catalyst': 'Squeeze'
    };
    const factorBars = (hold.factors || []).map(f => {
        const name = factorNames[f.name] || f.name;
        const pct = Math.min(100, Math.max(0, f.score));
        const color = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--blue)' : pct >= 35 ? 'var(--orange)' : 'var(--red)';
        return `<div class="swing-factor-row">
            <span class="swing-factor-name">${name}</span>
            <div class="swing-factor-bar"><div class="swing-factor-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="swing-factor-val">${f.score}</span>
        </div>`;
    }).join('');

    // Metrics
    const deltaVal = greeks.delta ? (typeof greeks.delta === 'number' ? greeks.delta.toFixed(2) : greeks.delta) : '--';
    const thetaDay = thetaBurn.daily_decay_cost ? `$${thetaBurn.daily_decay_cost}` : '--';
    const ivChange = ivMon.iv_change_pct != null ? `${ivMon.iv_change_pct > 0 ? '+' : ''}${ivMon.iv_change_pct.toFixed(1)}%` : '--';
    const dteVal = thetaBurn.dte != null ? thetaBurn.dte : '--';
    const regimeLabel = regime.current_label || '--';

    return `<div class="swing-trade-card signal-${holdClass}">
        <div class="swing-header">
            <div class="swing-header-left">
                <div class="swing-score-ring ${holdClass}">
                    <span class="score-num">${hold.score || 0}</span>
                    <span class="score-lbl">${hold.label || '--'}</span>
                </div>
                <div>
                    <span class="swing-ticker">${trade.ticker}</span>
                    <span class="swing-strike-info">$${trade.strike} ${trade.opt_type.toUpperCase()} | ${trade.expiration}</span>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="swing-pnl-badge ${pnlClass}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% ($${(pnl.pnl_dollar_100 || 0) >= 0 ? '+' : ''}${(pnl.pnl_dollar_100 || 0).toFixed(0)})</span>
            </div>
        </div>
        <div class="swing-signal-banner ${holdClass}">${signal}</div>
        <div class="swing-metrics">
            <div class="swing-metric"><div class="metric-val">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</div><div class="metric-lbl">P&L</div></div>
            <div class="swing-metric"><div class="metric-val">${deltaVal}</div><div class="metric-lbl">Delta</div></div>
            <div class="swing-metric"><div class="metric-val">${thetaDay}</div><div class="metric-lbl">Theta/Day</div></div>
            <div class="swing-metric"><div class="metric-val">${ivChange}</div><div class="metric-lbl">IV Change</div></div>
            <div class="swing-metric"><div class="metric-val">${dteVal}</div><div class="metric-lbl">DTE</div></div>
            <div class="swing-metric"><div class="metric-val">${regimeLabel}</div><div class="metric-lbl">Regime</div></div>
        </div>
        <div class="swing-factors">${factorBars}</div>
        <div class="swing-footer">
            <button onclick="refreshSwingTrades()">Re-analyze</button>
            <button class="close-trade" onclick="closeSwingTrade(${idx})">Close Trade</button>
        </div>
    </div>`;
}

function closeSwingTrade(idx) {
    const trades = getSwingTrades();
    if (idx >= 0 && idx < trades.length) {
        trades.splice(idx, 1);
        saveSwingTrades(trades);
        renderSwingTrades();
    }
}

function startSwingAutoRefresh() {
    if (_swingRefreshTimer) clearInterval(_swingRefreshTimer);
    _swingRefreshTimer = setInterval(() => {
        // Only refresh during market hours M-F 9:30-16:00 ET
        const now = new Date();
        const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const day = et.getDay();
        const h = et.getHours();
        const m = et.getMinutes();
        const mins = h * 60 + m;
        if (day >= 1 && day <= 5 && mins >= 570 && mins <= 960) {
            const trades = getSwingTrades();
            if (trades.length > 0) refreshSwingTrades();
        }
    }, 60000);
}

// Init swing trades on page load
document.addEventListener('DOMContentLoaded', () => {
    renderSwingTrades();
    startSwingAutoRefresh();
});

// =============================================================================
// BEST SETUP SCANNER (Backtest Tab)
// =============================================================================
const SCANNER_TICKERS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'IBIT', 'GLD'];
window._multiTickerResults = null;
window._scannerFilterMode = 'overall';

// ── Feature 1: Edge Score (PhD Intelligence) ───────────────────────────────
function computeScannerScore(data) {
    // Use PhD edge score if available
    if (data.intelligence?.edge_score != null) {
        return Math.round(Math.min(100, Math.max(0, data.intelligence.edge_score)));
    }
    // Fallback to composite score
    return Math.round(Math.min(100, Math.max(0, data.composite?.score ?? 0)));
}

// ── Feature 3: Conviction Meter (PhD Intelligence) ─────────────────────────
function computeConviction(data) {
    const intel = data.intelligence;
    // If PhD intelligence available, use 8 PhD signals
    if (intel) {
        const signals = [];

        // 1. Edge Direction
        const dir = (intel.edge_direction || '').toLowerCase();
        signals.push({ name: 'Edge', dir: dir === 'bullish' ? 'bullish' : dir === 'bearish' ? 'bearish' : 'neutral' });

        // 2. Regime
        const regime = (intel.combined_regime || '').toLowerCase();
        if (regime.includes('opportunity') || regime.includes('melt_up')) signals.push({ name: 'Regime', dir: 'bullish' });
        else if (regime.includes('danger') || regime.includes('high_risk')) signals.push({ name: 'Regime', dir: 'bearish' });
        else signals.push({ name: 'Regime', dir: 'neutral' });

        // 3. VRP
        const vrp = intel.vrp ?? 0;
        if (vrp > 2) signals.push({ name: 'VRP', dir: 'bullish' }); // rich premium = good for selling
        else if (vrp < 0) signals.push({ name: 'VRP', dir: 'bearish' }); // negative = cheap options
        else signals.push({ name: 'VRP', dir: 'neutral' });

        // 4. Flow Toxicity
        const toxDir = (intel.flow_toxicity?.flow_direction || '').toLowerCase();
        if (toxDir === 'bullish') signals.push({ name: 'Toxicity', dir: 'bullish' });
        else if (toxDir === 'bearish') signals.push({ name: 'Toxicity', dir: 'bearish' });
        else signals.push({ name: 'Toxicity', dir: 'neutral' });

        // 5. Term Structure
        const ts = (intel.term_structure || '').toLowerCase();
        if (ts === 'contango' || ts === 'normal') signals.push({ name: 'Term', dir: 'bullish' });
        else if (ts === 'inverted') signals.push({ name: 'Term', dir: 'bearish' });
        else signals.push({ name: 'Term', dir: 'neutral' });

        // 6. Skew
        const skew = intel.skew_ratio ?? 1.0;
        if (Math.abs(skew) < 0.05) signals.push({ name: 'Skew', dir: 'bullish' }); // flat
        else if (skew > 0.15) signals.push({ name: 'Skew', dir: 'bearish' }); // steep
        else signals.push({ name: 'Skew', dir: 'neutral' });

        // 7. Strategy Type
        const stType = (intel.strategy?.type || '').toLowerCase();
        if (stType === 'short_premium') signals.push({ name: 'Strategy', dir: 'bullish' });
        else if (stType === 'long_premium') signals.push({ name: 'Strategy', dir: 'bearish' });
        else signals.push({ name: 'Strategy', dir: 'neutral' });

        // 8. Kelly
        const kelly = intel.kelly_fraction ?? 0;
        if (kelly > 0.15) signals.push({ name: 'Kelly', dir: 'bullish' });
        else if (kelly < 0.05) signals.push({ name: 'Kelly', dir: 'bearish' });
        else signals.push({ name: 'Kelly', dir: 'neutral' });

        const bullish = signals.filter(s => s.dir === 'bullish').length;
        const bearish = signals.filter(s => s.dir === 'bearish').length;
        return { total: signals.length, bullish, bearish, signals };
    }

    // Fallback: old conviction logic when no intelligence
    const signals = [];
    const label = (data.composite?.label || '').toUpperCase();
    if (label.includes('BULLISH')) signals.push({ name: 'Composite', dir: 'bullish' });
    else if (label.includes('BEARISH')) signals.push({ name: 'Composite', dir: 'bearish' });
    else signals.push({ name: 'Composite', dir: 'neutral' });

    const netFlow = (data.smart_money?.net_flow || '').toLowerCase();
    if (netFlow === 'bullish') signals.push({ name: 'Smart Flow', dir: 'bullish' });
    else if (netFlow === 'bearish') signals.push({ name: 'Smart Flow', dir: 'bearish' });
    else signals.push({ name: 'Smart Flow', dir: 'neutral' });

    const skewLabel = (data.vol_surface?.skew_label || '').toLowerCase();
    if (skewLabel === 'normal' || skewLabel === 'flat') signals.push({ name: 'Skew', dir: 'bullish' });
    else if (skewLabel === 'steep') signals.push({ name: 'Skew', dir: 'bearish' });
    else signals.push({ name: 'Skew', dir: 'neutral' });

    const termSignal = (data.vol_surface?.term_signal || '').toLowerCase();
    if (termSignal === 'normal' || termSignal === 'contango') signals.push({ name: 'Term', dir: 'bullish' });
    else if (termSignal === 'inverted') signals.push({ name: 'Term', dir: 'bearish' });
    else signals.push({ name: 'Term', dir: 'neutral' });

    const bullish = signals.filter(s => s.dir === 'bullish').length;
    const bearish = signals.filter(s => s.dir === 'bearish').length;
    return { total: signals.length, bullish, bearish, signals };
}

// Enrich all scanner results with computed scores + conviction
function enrichScannerResults(results) {
    results.forEach(r => {
        r.scannerScore = computeScannerScore(r.data);
        r.conviction = computeConviction(r.data);
    });
}

// ── Feature 2: Filter Mode Scores (PhD Intelligence) ───────────────────────
function computeBuyCallsScore(data) {
    const intel = data.intelligence;
    if (intel) {
        let score = 0;
        // Regime: opportunity/melt_up = bullish (35)
        const regime = (intel.combined_regime || '').toLowerCase();
        if (regime.includes('opportunity') || regime.includes('melt_up')) score += 35;
        else if (!regime.includes('danger') && !regime.includes('high_risk')) score += 15;
        // VRP < 2 = cheap options, good for buying (25)
        if ((intel.vrp ?? 0) < 0) score += 25;
        else if ((intel.vrp ?? 0) < 2) score += 15;
        // GEX volatile = momentum potential (20)
        if ((intel.gex_regime || '') === 'volatile') score += 20;
        else if ((intel.gex_regime || '') === 'transitional') score += 10;
        // Bullish flow toxicity (20)
        if ((intel.flow_toxicity?.flow_direction || '') === 'bullish') score += 20;
        else if ((intel.flow_toxicity?.flow_direction || '') !== 'bearish') score += 5;
        return Math.min(100, score);
    }
    // Fallback
    return Math.round(Math.min(100, Math.max(0, data.composite?.score ?? 0)));
}

function computeBuyPutsScore(data) {
    const intel = data.intelligence;
    if (intel) {
        let score = 0;
        // Regime: danger/high_risk (35)
        const regime = (intel.combined_regime || '').toLowerCase();
        if (regime.includes('danger') || regime.includes('high_risk')) score += 35;
        else if (!regime.includes('opportunity') && !regime.includes('melt_up')) score += 15;
        // Bearish flow toxicity (25)
        if ((intel.flow_toxicity?.flow_direction || '') === 'bearish') score += 25;
        else if ((intel.flow_toxicity?.flow_direction || '') !== 'bullish') score += 5;
        // VRP < 2 = cheap options (20)
        if ((intel.vrp ?? 0) < 0) score += 20;
        else if ((intel.vrp ?? 0) < 2) score += 12;
        // Steep skew (20)
        const skew = Math.abs(intel.skew_ratio ?? 0);
        if (skew > 0.15) score += 20;
        else if (skew > 0.08) score += 10;
        return Math.min(100, score);
    }
    return Math.round(Math.min(100, Math.max(0, data.composite?.score ?? 0)));
}

function computeSellPremiumScore(data) {
    const intel = data.intelligence;
    if (intel) {
        let score = 0;
        // VRP > 4 = rich premium (35)
        const vrp = intel.vrp ?? 0;
        if (vrp > 4) score += 35;
        else if (vrp > 2) score += 20;
        else if (vrp > 0) score += 8;
        // GEX pinned = low gamma risk (25)
        if ((intel.gex_regime || '') === 'pinned') score += 25;
        else if ((intel.gex_regime || '') === 'transitional') score += 12;
        // Low toxicity = stable environment (20)
        const tox = intel.flow_toxicity?.toxicity ?? 0.5;
        if (tox < 0.3) score += 20;
        else if (tox < 0.5) score += 10;
        // Contango = normal term structure (20)
        const ts = (intel.term_structure || '').toLowerCase();
        if (ts === 'contango' || ts === 'normal') score += 20;
        else if (ts !== 'inverted') score += 8;
        return Math.min(100, score);
    }
    return Math.round(Math.min(100, Math.max(0, data.composite?.score ?? 0)));
}

function computeMomentumScore(data) {
    const intel = data.intelligence;
    if (intel) {
        let score = 0;
        // Regime: opportunity/melt_up (35)
        const regime = (intel.combined_regime || '').toLowerCase();
        if (regime.includes('opportunity') || regime.includes('melt_up')) score += 35;
        else if (!regime.includes('danger')) score += 10;
        // GEX volatile = momentum (25)
        if ((intel.gex_regime || '') === 'volatile') score += 25;
        else if ((intel.gex_regime || '') === 'transitional') score += 12;
        // High flow toxicity = informed trading (25)
        const tox = intel.flow_toxicity?.toxicity ?? 0;
        if (tox > 0.6) score += 25;
        else if (tox > 0.4) score += 12;
        // Air pockets from dealer hedging (15)
        const airPockets = data.dealer_flow?.air_pockets?.length || data.dealer_hedging?.air_pockets?.length || 0;
        if (airPockets > 0) score += 15;
        return Math.min(100, score);
    }
    return Math.round(Math.min(100, Math.max(0, data.composite?.score ?? 0)));
}

function setScannerFilter(mode) {
    window._scannerFilterMode = mode;
    // Update button states
    document.querySelectorAll('.scanner-filter-btn').forEach(btn => btn.classList.remove('active'));
    const clickedBtn = document.querySelector(`.scanner-filter-btn[onclick*="${mode}"]`);
    if (clickedBtn) clickedBtn.classList.add('active');

    // Re-sort and render from cache
    const results = window._multiTickerResults;
    if (!results || results.length === 0) return;

    const ranked = rankScannerResults(results);
    renderScannerResults(ranked);
}

async function runBestSetupScanner() {
    const btn = document.getElementById('scanner-scan-btn');
    const placeholder = document.getElementById('scanner-placeholder');
    const resultsEl = document.getElementById('scanner-results');
    const statusEl = document.getElementById('scanner-status');
    const tsEl = document.getElementById('scanner-timestamp');
    const progressEl = document.getElementById('scanner-progress');
    const detailEl = document.getElementById('scanner-xray-detail');

    if (btn) { btn.disabled = true; btn.textContent = 'Scanning 0/' + SCANNER_TICKERS.length + '...'; }
    if (placeholder) placeholder.style.display = 'none';
    if (detailEl) detailEl.style.display = 'none';
    if (resultsEl) resultsEl.innerHTML = '';

    // Render progress dots
    renderScannerProgress();
    if (progressEl) progressEl.style.display = 'flex';

    let completed = 0;
    let okCount = 0;
    const results = [];

    const promises = SCANNER_TICKERS.map(async (ticker, idx) => {
        const url = `${API_BASE}/options/xray/${ticker}?intel=true`;
        try {
            const resp = await fetch(url);
            const json = await resp.json();
            completed++;
            if (btn) btn.textContent = `Scanning ${completed}/${SCANNER_TICKERS.length}...`;
            if (json.ok && json.data) {
                okCount++;
                updateScannerDot(idx, 'ok');
                return { ticker, data: json.data, price: json.data.trade_zones?.current_price || 0 };
            } else {
                updateScannerDot(idx, 'error');
                return null;
            }
        } catch (e) {
            completed++;
            if (btn) btn.textContent = `Scanning ${completed}/${SCANNER_TICKERS.length}...`;
            updateScannerDot(idx, 'error');
            return null;
        }
    });

    const raw = await Promise.all(promises);
    const valid = raw.filter(Boolean);
    window._multiTickerResults = valid;

    if (statusEl) statusEl.textContent = `${okCount}/${SCANNER_TICKERS.length} OK`;
    if (tsEl) tsEl.textContent = new Date().toLocaleTimeString();
    if (progressEl) setTimeout(() => { progressEl.style.display = 'none'; }, 1500);

    if (valid.length > 0) {
        enrichScannerResults(valid);
        // Reset filter mode & show filter bar
        window._scannerFilterMode = 'overall';
        const filterBar = document.getElementById('scanner-filter-bar');
        if (filterBar) filterBar.classList.add('visible');
        document.querySelectorAll('.scanner-filter-btn').forEach(b => b.classList.remove('active'));
        const defaultBtn = document.querySelector('.scanner-filter-btn[onclick*="overall"]');
        if (defaultBtn) defaultBtn.classList.add('active');

        const ranked = rankScannerResults(valid);
        renderScannerResults(ranked);
    } else {
        if (resultsEl) resultsEl.innerHTML = '<div style="text-align:center;color:var(--red);padding:20px;">All scans failed. Check network / API.</div>';
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Scan All'; }
}

function rankScannerResults(results) {
    const mode = window._scannerFilterMode || 'overall';
    return results.slice().sort((a, b) => {
        switch (mode) {
            case 'buycalls':
                return computeBuyCallsScore(b.data) - computeBuyCallsScore(a.data);
            case 'buyputs':
                return computeBuyPutsScore(b.data) - computeBuyPutsScore(a.data);
            case 'sellpremium':
                return computeSellPremiumScore(b.data) - computeSellPremiumScore(a.data);
            case 'squeeze':
                return (b.data.squeeze_pin?.squeeze_score ?? 0) - (a.data.squeeze_pin?.squeeze_score ?? 0);
            case 'momentum':
                return computeMomentumScore(b.data) - computeMomentumScore(a.data);
            default: { // 'overall' — sort by edge score, tiebreak by edge confidence
                const sa = a.data.intelligence?.edge_score ?? a.scannerScore ?? 0;
                const sb = b.data.intelligence?.edge_score ?? b.scannerScore ?? 0;
                if (sb !== sa) return sb - sa;
                const confOrder = { high: 0, medium: 1, low: 2 };
                const confA = confOrder[a.data.intelligence?.edge_confidence] ?? 3;
                const confB = confOrder[b.data.intelligence?.edge_confidence] ?? 3;
                return confA - confB;
            }
        }
    });
}

function renderScannerResults(ranked) {
    const el = document.getElementById('scanner-results');
    if (!el) return;
    const mode = window._scannerFilterMode || 'overall';

    const regimeColors = {
        'opportunity': 'var(--green)', 'melt_up': 'var(--blue)',
        'pinned': 'var(--orange)', 'neutral': 'var(--text-muted)',
        'volatile': 'var(--purple)', 'danger': 'var(--red)', 'high_risk': 'var(--red)',
        'transitional': 'var(--cyan)'
    };
    const regimeBgColors = {
        'opportunity': 'rgba(34,197,94,0.15)', 'melt_up': 'rgba(59,130,246,0.15)',
        'pinned': 'rgba(249,115,22,0.12)', 'neutral': 'rgba(113,113,122,0.1)',
        'volatile': 'rgba(168,85,247,0.15)', 'danger': 'rgba(239,68,68,0.15)', 'high_risk': 'rgba(239,68,68,0.15)',
        'transitional': 'rgba(6,182,212,0.12)'
    };

    const rows = ranked.map((r, idx) => {
        const intel = r.data.intelligence;

        // Rank badge color
        const rankColors = ['#FFD700', 'var(--purple)', 'var(--blue)'];
        const rankColor = idx < 3 ? rankColors[idx] : 'var(--text-dim)';

        // Edge score (primary)
        const edgeScore = intel?.edge_score ?? r.scannerScore ?? 0;
        const edgeColor = edgeScore >= 75 ? 'var(--green)' : edgeScore >= 55 ? 'var(--blue)' : edgeScore >= 40 ? 'var(--orange)' : 'var(--red)';

        // Regime badge
        const regime = intel?.combined_regime || 'neutral';
        const regimeKey = regime.toLowerCase().replace(/^neutral_.*/, 'neutral');
        const regimeColor = regimeColors[regimeKey] || 'var(--text-muted)';
        const regimeBg = regimeBgColors[regimeKey] || 'rgba(113,113,122,0.1)';
        const regimeLabel = regime.replace(/_/g, ' ').toUpperCase();

        // Conviction dots
        const conv = r.conviction || { total: 0, bullish: 0, bearish: 0, signals: [] };
        const dotsHtml = conv.signals.map(s =>
            `<span class="conviction-dot ${s.dir}" title="${s.name}: ${s.dir}"></span>`
        ).join('');
        const convCountHtml = `<span class="conviction-count">${conv.bullish}/${conv.total}</span>`;

        // Strategy name + type
        let strategyHtml = '<span style="color:var(--text-dim);font-size:0.7rem;">--</span>';
        if (intel?.strategy?.name) {
            const stName = intel.strategy.name;
            const stType = intel.strategy.type || '';
            const stTypeColor = stType === 'short_premium' ? 'var(--green)' : stType === 'long_premium' ? 'var(--blue)' : 'var(--text-muted)';
            const stTypeLabel = stType.replace(/_/g, ' ').toUpperCase();
            strategyHtml = `<span class="scanner-strategy">${stName}</span>
                <span class="scanner-strategy-type" style="color:${stTypeColor}">${stTypeLabel}</span>`;
        }

        // VRP badge
        let vrpBadge = '';
        if (intel && (intel.vrp ?? 0) > 2) {
            vrpBadge = `<span class="scanner-vrp-badge">VRP ${intel.vrp}</span>`;
        }

        // Mode-specific highlight badges
        let badges = '';
        if (intel) {
            if (mode === 'buycalls') {
                if (regimeKey === 'opportunity' || regimeKey === 'melt_up') badges += `<span class="signal-highlight">${regimeLabel}</span>`;
                if ((intel.flow_toxicity?.flow_direction || '') === 'bullish') badges += '<span class="signal-highlight">BULL FLOW</span>';
            } else if (mode === 'buyputs') {
                if (regimeKey === 'danger' || regimeKey === 'high_risk') badges += `<span class="signal-highlight">${regimeLabel}</span>`;
                if ((intel.flow_toxicity?.flow_direction || '') === 'bearish') badges += '<span class="signal-highlight">BEAR FLOW</span>';
            } else if (mode === 'sellpremium') {
                if ((intel.vrp ?? 0) > 4) badges += '<span class="signal-highlight">RICH VRP</span>';
                if ((intel.gex_regime || '') === 'pinned') badges += '<span class="signal-highlight">PINNED</span>';
            } else if (mode === 'squeeze') {
                const sq = r.data.squeeze_pin?.squeeze_score ?? 0;
                const sqDir = (r.data.squeeze_pin?.direction || '').toUpperCase();
                badges += `<span class="signal-highlight">SQ ${sq} ${sqDir}</span>`;
            } else if (mode === 'momentum') {
                if ((intel.gex_regime || '') === 'volatile') badges += '<span class="signal-highlight">VOLATILE</span>';
                if ((intel.flow_toxicity?.toxicity ?? 0) > 0.6) badges += '<span class="signal-highlight">HIGH TOX</span>';
            }
        }

        const priceStr = r.price ? '$' + (r.price >= 1000 ? r.price.toFixed(0) : r.price.toFixed(2)) : '--';

        return `<div class="scanner-row${idx === 0 ? ' active' : ''}" onclick="scannerDrillDown('${r.ticker}', ${idx})" data-idx="${idx}">
            <div class="scanner-rank" style="background:${rankColor}">${idx + 1}</div>
            <div class="scanner-ticker">${r.ticker}</div>
            <div class="scanner-price">${priceStr}</div>
            <div class="scanner-edge-cell">
                <span class="scanner-edge-value" style="color:${edgeColor}">${edgeScore}</span>
            </div>
            <div class="scanner-score-cell">
                <span class="scanner-regime-badge" style="color:${regimeColor};background:${regimeBg}">${regimeLabel}</span>
            </div>
            <div class="scanner-conviction">
                <span class="conviction-dots">${dotsHtml}</span>
                ${convCountHtml}
            </div>
            <div class="scanner-idea">${strategyHtml}${vrpBadge}${badges}</div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="scanner-grid">${rows}</div>`;

    // Auto drill-down into #1
    if (ranked.length > 0) {
        scannerDrillDown(ranked[0].ticker, 0);
    }
}

function scannerDrillDown(ticker, idx) {
    // Highlight active row
    document.querySelectorAll('.scanner-row').forEach(r => r.classList.remove('active'));
    const row = document.querySelector(`.scanner-row[data-idx="${idx}"]`);
    if (row) row.classList.add('active');

    const results = window._multiTickerResults;
    if (!results) return;
    const entry = results.find(r => r.ticker === ticker);
    if (!entry) return;

    const d = entry.data;
    const detailEl = document.getElementById('scanner-xray-detail');
    if (!detailEl) return;

    // Build drill-down HTML reusing the same rendering logic but to inline HTML
    const score = d.composite?.score ?? 0;
    const label = d.composite?.label || 'NEUTRAL';
    const scoreColor = score >= 75 ? 'var(--green)' : score >= 60 ? 'var(--blue)' : score >= 45 ? 'var(--orange)' : 'var(--red)';

    // Verdict banner
    const colors = {
        'STRONG BULLISH': {bg:'rgba(34,197,94,0.2)',c:'var(--green)'},
        'BULLISH': {bg:'rgba(59,130,246,0.2)',c:'var(--blue)'},
        'NEUTRAL': {bg:'rgba(251,191,36,0.15)',c:'var(--orange)'},
        'BEARISH': {bg:'rgba(239,68,68,0.15)',c:'var(--red)'},
        'STRONG BEARISH': {bg:'rgba(239,68,68,0.25)',c:'var(--red)'}
    };
    const clr = colors[label] || colors['NEUTRAL'];

    // Composite factors
    let factorsHtml = '';
    if (d.composite?.factors) {
        d.composite.factors.forEach(f => {
            const pct = Math.round(f.score);
            const barColor = f.score >= 60 ? 'var(--green)' : f.score >= 40 ? 'var(--orange)' : 'var(--red)';
            factorsHtml += `<div class="factor-bar-row">
                <span class="factor-bar-name">${f.name}</span>
                <div class="factor-bar-track"><div class="factor-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
                <span class="factor-bar-value" style="color:${barColor}">${pct}</span>
            </div>`;
        });
    }

    // Trade ideas
    const ideas = d.composite?.trade_ideas || [];
    const typeIcons = { bullish:'&#9650;', bearish:'&#9660;', neutral:'&#9644;', breakout:'&#9733;', value:'&#127919;' };
    let ideasHtml = '';
    if (ideas.length) {
        const cards = ideas.map((idea, idx) => {
            if (idea.phd_strategy) {
                return _renderPhdIdeaCard(idea, idx);
            }
            const icon = typeIcons[idea.type] || '&#8226;';
            const conf = idea.confidence || '';
            const confBadge = conf ? `<span class="trade-idea-confidence confidence-${conf}">${conf.toUpperCase()}</span>` : '';
            return `<div class="trade-idea-card" data-type="${idea.type}">
                <div class="trade-idea-header">${icon} ${idea.title} ${confBadge}</div>
                <div class="trade-idea-row"><span class="trade-idea-label label-if">IF</span><span>${idea.condition}</span></div>
                <div class="trade-idea-row"><span class="trade-idea-label label-action">&rarr;</span><span>${idea.action}</span></div>
                <div class="trade-idea-row"><span class="trade-idea-label label-tp">TP</span><span>${idea.target}</span></div>
                <div class="trade-idea-row"><span class="trade-idea-label label-sl">SL</span><span>${idea.stop}</span></div>
                <div class="trade-idea-rationale">${idea.rationale}</div>
            </div>`;
        }).join('');
        const titleLabel = ideas.some(i => i.phd_strategy) ? 'PhD TRADE IDEAS' : 'TRADE IDEAS';
        ideasHtml = `<div style="margin-bottom:16px;"><div class="trade-ideas-title">${titleLabel}</div>${cards}</div>`;
    }

    // Squeeze/pin gauges
    let squeezeHtml = '';
    if (d.squeeze_pin) {
        const sp = d.squeeze_pin;
        const sq = sp.squeeze_score || 0;
        const pin = sp.pin_score || 0;
        const sqColor = sq >= 70 ? 'var(--red)' : sq >= 40 ? 'var(--orange)' : 'var(--green)';
        const pinColor = pin >= 70 ? 'var(--purple)' : pin >= 40 ? 'var(--orange)' : 'var(--text-muted)';
        squeezeHtml = `<div class="xray-section"><div class="xray-section-header"><span>Gamma Squeeze / Pin Risk</span></div>
            <div class="xray-section-body" style="display:block;">
                <div class="gauge-row">
                    <div class="gauge-item"><div class="gauge-circle" style="width:70px;height:70px;"><span class="gauge-value" style="color:${sqColor}">${sq}</span></div><div class="gauge-label">SQUEEZE</div></div>
                    <div class="gauge-item"><div class="gauge-circle" style="width:70px;height:70px;"><span class="gauge-value" style="color:${pinColor}">${pin}</span></div><div class="gauge-label">PIN RISK</div></div>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);text-align:center;padding:6px;background:var(--bg-hover);border-radius:6px;">${sp.explanation || ''}</div>
            </div></div>`;
    }

    // Vol surface
    let volHtml = '';
    if (d.vol_surface) {
        const vs = d.vol_surface;
        const skew = vs.skew_25d;
        const skewLabel = vs.skew_label || '--';
        const termStruct = vs.term_structure || '--';
        const termSignal = vs.term_signal || '--';
        const skewColor = skewLabel === 'steep' ? 'red' : skewLabel === 'flat' ? 'orange' : 'green';
        const termColor = termSignal === 'inverted' ? 'red' : termSignal === 'neutral' ? 'orange' : 'green';
        volHtml = `<div class="xray-section"><div class="xray-section-header"><span>Volatility Surface</span></div>
            <div class="xray-section-body" style="display:block;">
                <span class="xray-badge ${skewColor}">SKEW: ${skew != null ? (skew*100).toFixed(1) + '%' : '--'} (${skewLabel})</span>
                <span class="xray-badge ${termColor}">TERM: ${termStruct} (${termSignal})</span>
            </div></div>`;
    }

    // Smart money
    let smartHtml = '';
    if (d.smart_money) {
        const sm = d.smart_money;
        const flow = sm.net_flow || '--';
        const callN = sm.total_call_notional || 0;
        const putN = sm.total_put_notional || 0;
        const flowColor = flow === 'bullish' ? 'green' : 'red';
        smartHtml = `<div class="xray-section"><div class="xray-section-header"><span>Smart Money Footprint</span></div>
            <div class="xray-section-body" style="display:block;">
                <span class="xray-badge ${flowColor}" style="font-size:0.8rem;">${flow.toUpperCase()} FLOW: $${fmtNotional(callN)} calls / $${fmtNotional(putN)} puts</span>
            </div></div>`;
    }

    // Edge score badge
    const intel = d.intelligence;
    const edgeScore = intel?.edge_score ?? entry.scannerScore ?? computeScannerScore(d);
    const edgeColor = edgeScore >= 75 ? 'var(--green)' : edgeScore >= 55 ? 'var(--blue)' : edgeScore >= 40 ? 'var(--orange)' : 'var(--red)';

    // Conviction detail chips
    const conv = entry.conviction || computeConviction(d);
    const convChips = conv.signals.map(s => {
        const cls = s.dir === 'bullish' ? 'bullish' : s.dir === 'bearish' ? 'bearish' : 'neutral-sig';
        const arrow = s.dir === 'bullish' ? '&#9650;' : s.dir === 'bearish' ? '&#9660;' : '&#9644;';
        return `<span class="conviction-signal ${cls}">${arrow} ${s.name}</span>`;
    }).join('');
    const convSummary = `${conv.bullish} bullish / ${conv.bearish} bearish / ${conv.total - conv.bullish - conv.bearish} neutral`;

    // PhD Intelligence section
    let intelHtml = '';
    if (intel) {
        const regimeColors = {
            'opportunity': 'var(--green)', 'melt_up': 'var(--blue)',
            'pinned': 'var(--orange)', 'neutral': 'var(--text-muted)',
            'volatile': 'var(--purple)', 'danger': 'var(--red)', 'high_risk': 'var(--red)',
            'transitional': 'var(--cyan)'
        };
        const regimeKey = (intel.combined_regime || 'neutral').toLowerCase().replace(/^neutral_.*/, 'neutral');
        const regimeColor = regimeColors[regimeKey] || 'var(--text-muted)';
        const gexRegimeColor = regimeColors[intel.gex_regime] || 'var(--text-muted)';
        const vrpColor = (intel.vrp ?? 0) > 4 ? 'var(--green)' : (intel.vrp ?? 0) > 2 ? 'var(--blue)' : (intel.vrp ?? 0) > 0 ? 'var(--orange)' : 'var(--red)';
        const toxColor = (intel.flow_toxicity?.toxicity ?? 0) > 0.6 ? 'var(--red)' : (intel.flow_toxicity?.toxicity ?? 0) > 0.3 ? 'var(--orange)' : 'var(--green)';
        const kellyPct = Math.round((intel.kelly_fraction ?? 0) * 100);
        const stType = (intel.strategy?.type || '').replace(/_/g, ' ').toUpperCase();
        const stTypeColor = (intel.strategy?.type || '') === 'short_premium' ? 'var(--green)' : 'var(--blue)';

        intelHtml = `<div class="xray-section"><div class="xray-section-header"><span>PhD Intelligence</span></div>
            <div class="xray-section-body" style="display:block;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div style="padding:8px;background:var(--bg-hover);border-radius:6px;">
                        <div style="font-size:0.6rem;color:var(--text-muted);letter-spacing:0.08em;">EDGE SCORE</div>
                        <div style="font-size:1.4rem;font-weight:700;color:${edgeColor}">${edgeScore}<span style="font-size:0.7rem;color:var(--text-dim)">/100</span></div>
                        <div style="font-size:0.65rem;color:var(--text-muted);">${(intel.edge_direction || 'neutral').toUpperCase()} &middot; ${(intel.edge_confidence || 'low').toUpperCase()}</div>
                    </div>
                    <div style="padding:8px;background:var(--bg-hover);border-radius:6px;">
                        <div style="font-size:0.6rem;color:var(--text-muted);letter-spacing:0.08em;">STRATEGY</div>
                        <div style="font-size:0.85rem;font-weight:700;color:var(--text);margin-top:4px;">${intel.strategy?.name || '--'}</div>
                        <div style="font-size:0.65rem;color:${stTypeColor};">${stType}</div>
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                    <span class="xray-badge" style="color:${regimeColor}">REGIME: ${(intel.combined_regime || 'neutral').replace(/_/g, ' ').toUpperCase()}</span>
                    <span class="xray-badge" style="color:${gexRegimeColor}">GEX: ${(intel.gex_regime || '--').toUpperCase()}</span>
                    <span class="xray-badge" style="color:${vrpColor}">VRP: ${intel.vrp ?? '--'} (${(intel.vrp_signal || '--').toUpperCase()})</span>
                    <span class="xray-badge" style="color:${toxColor}">TOXICITY: ${((intel.flow_toxicity?.toxicity ?? 0) * 100).toFixed(0)}% (${(intel.flow_toxicity?.label || '--').toUpperCase()})</span>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <span class="xray-badge">KELLY: ${kellyPct}%</span>
                    <span class="xray-badge">RISK: ${(intel.risk_level || '--').toUpperCase()}</span>
                    <span class="xray-badge">FLOW: ${(intel.flow_toxicity?.flow_direction || '--').toUpperCase()}</span>
                    <span class="xray-badge">FACTORS: ${intel.n_factors_agree ?? '--'}/8</span>
                </div>
            </div></div>`;
    }

    detailEl.innerHTML = `
        <div class="card-header">
            <div class="card-title">X-RAY DETAIL <span style="color:var(--cyan);margin-left:8px;">${ticker}</span></div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="scanner-sscore-badge" style="background:rgba(217,70,239,0.15);color:var(--magenta);">EDGE: ${edgeScore}</span>
                <div style="font-size:0.8rem;font-weight:700;padding:4px 14px;border-radius:6px;background:${clr.bg};color:${clr.c}">COMPOSITE: ${score}</div>
            </div>
        </div>
        <div class="card-body">
            <div class="verdict-banner" style="display:flex;background:${clr.bg};border-left:4px solid ${clr.c};margin-bottom:12px;">
                <div class="verdict-text" style="color:${clr.c}">${label}</div>
                <div class="verdict-rec">${d.composite?.interpretation || ''}</div>
            </div>
            <div style="margin-bottom:14px;">
                <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;">CONVICTION METER — ${convSummary}</div>
                <div class="conviction-detail">${convChips}</div>
            </div>
            ${intelHtml}
            ${ideasHtml}
            <div class="xray-section"><div class="xray-section-header"><span>Composite Edge Score</span></div>
                <div class="xray-section-body" style="display:block;">
                    <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
                        <div class="score-ring" style="border-color:${scoreColor}">
                            <div class="score-number" style="color:${scoreColor}">${score}</div>
                            <div class="score-max">/100</div>
                        </div>
                        <div style="flex:1;min-width:200px;">${factorsHtml}</div>
                    </div>
                </div>
            </div>
            ${squeezeHtml}
            ${volHtml}
            ${smartHtml}
        </div>`;
    detailEl.style.display = 'block';
}

function renderScannerProgress() {
    const el = document.getElementById('scanner-progress');
    if (!el) return;
    const dots = SCANNER_TICKERS.map((t, i) =>
        `<div class="scanner-dot" id="scanner-dot-${i}" title="${t}"><span>${t}</span></div>`
    ).join('');
    el.innerHTML = dots;
}

function updateScannerDot(idx, status) {
    const dot = document.getElementById('scanner-dot-' + idx);
    if (!dot) return;
    dot.classList.remove('ok', 'error');
    dot.classList.add(status);
}


// =============================================================================
// F6: OPTIONS FLOW TIMELINE ON PRICE CHART
// =============================================================================
let _flowMarkers = [];

async function overlayFlowOnChart(ticker) {
    if (!priceSeries || !ticker) return;

    try {
        const res = await fetch(`${API_BASE}/options/whales?min_premium=50000`);
        const data = await res.json();
        const trades = data.whales || data.data || [];

        if (trades.length === 0) {
            _flowMarkers = [];
            priceSeries.setMarkers([]);
            return;
        }

        // Convert to LightweightCharts marker format
        const markers = trades
            .filter(t => (t.ticker || '').toUpperCase() === ticker.toUpperCase())
            .slice(0, 20)
            .map(t => {
                const isBuy = (t.side || '').toLowerCase() === 'buy';
                const isCall = (t.type || '').toUpperCase() === 'C';
                const premium = ((t.premium || 0) / 1000).toFixed(0);
                // Use current time as marker time (trades don't have precise timestamps from this endpoint)
                const now = new Date();
                const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                return {
                    time: timeStr,
                    position: isBuy ? 'belowBar' : 'aboveBar',
                    color: isCall ? '#22c55e' : '#ef4444',
                    shape: isBuy ? 'arrowUp' : 'arrowDown',
                    text: `${isCall ? 'C' : 'P'}$${(t.strike || 0)} $${premium}K`
                };
            })
            .filter(m => m.time);

        // Deduplicate by time (LightweightCharts requires unique times)
        const seen = new Set();
        _flowMarkers = markers.filter(m => {
            const key = m.time + m.text;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        priceSeries.setMarkers(_flowMarkers);
    } catch (e) {
        console.error('Flow overlay failed:', e);
    }
}

function toggleFlowMarkers() {
    saveToggles();
    const checked = document.getElementById('viz-toggle-flow')?.checked;
    if (checked && optionsAnalysisTicker) {
        overlayFlowOnChart(optionsAnalysisTicker);
    } else {
        _flowMarkers = [];
        if (priceSeries) priceSeries.setMarkers([]);
    }
}

// =============================================================================
// F9: TERM STRUCTURE VISUALIZATION
// =============================================================================
let termStructureChart = null;

async function loadTermStructure(ticker) {
    const container = document.getElementById('term-structure-container');
    const chartEl = document.getElementById('term-structure-chart');
    const labelEl = document.getElementById('term-structure-label');
    if (!container || !chartEl) return;

    if (!ticker) {
        container.style.display = 'none';
        return;
    }

    try {
        const isFutures = ticker.startsWith('/');
        const url = isFutures
            ? `${API_BASE}/options/term-structure?ticker=${encodeURIComponent(ticker)}`
            : `${API_BASE}/options/term-structure/${ticker}`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.ok || !data.data) {
            container.style.display = 'none';
            return;
        }

        const termData = data.data;
        let points = Array.isArray(termData.term_structure) ? termData.term_structure : (termData.points || []);

        // Build points from front/back summary if no array provided
        if (points.length < 2 && termData.front_dte != null && termData.back_dte != null) {
            points = [
                { dte: termData.front_dte, iv: termData.front_iv, expiration: termData.front_expiration },
                { dte: termData.back_dte, iv: termData.back_iv, expiration: termData.back_expiration }
            ];
        }

        if (points.length < 2) {
            container.style.display = 'none';
            return;
        }

        // Determine contango / backwardation
        const firstIV = points[0].iv || points[0].implied_volatility || 0;
        const lastIV = points[points.length - 1].iv || points[points.length - 1].implied_volatility || 0;
        const isContango = lastIV > firstIV;
        if (labelEl) {
            labelEl.innerHTML = isContango
                ? '<span style="color: var(--green);">CONTANGO</span> — Near-term IV < Far-term IV (normal)'
                : '<span style="color: var(--red);">BACKWARDATION</span> — Near-term IV > Far-term IV (fear)';
        }

        const categories = points.map(p => p.dte ? `${p.dte}d` : (p.expiration || ''));
        const ivValues = points.map(p => {
            const iv = p.iv || p.implied_volatility || 0;
            return (iv > 1 ? iv : iv * 100);
        });

        const chartOptions = {
            series: [{
                name: 'IV',
                data: ivValues
            }],
            chart: {
                type: 'area',
                height: 220,
                background: 'transparent',
                toolbar: { show: false },
                zoom: { enabled: false }
            },
            colors: [isContango ? '#22c55e' : '#ef4444'],
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] }
            },
            stroke: { curve: 'smooth', width: 2 },
            xaxis: {
                categories: categories,
                labels: { style: { colors: '#71717a', fontSize: '0.65rem' } },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: { colors: '#71717a', fontSize: '0.65rem' },
                    formatter: v => v.toFixed(1) + '%'
                }
            },
            grid: { borderColor: '#2a2a3a', strokeDashArray: 3 },
            tooltip: {
                theme: 'dark',
                y: { formatter: v => v.toFixed(1) + '%' }
            },
            dataLabels: { enabled: false }
        };

        if (termStructureChart) {
            termStructureChart.destroy();
        }
        termStructureChart = new ApexCharts(chartEl, chartOptions);
        termStructureChart.render();
        container.style.display = 'block';
    } catch (e) {
        console.error('Term structure load failed:', e);
        container.style.display = 'none';
    }
}

// =============================================================================
// PAPER TRADING DASHBOARD
// =============================================================================

let tradingRefreshInterval = null;
let tradingEquityChart = null;
let journalFilter = 'all';

// =============================================================================
// SKELETON MANAGER
// =============================================================================
const _skeletonOriginals = {};

function showSkeleton(containerId, type) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!_skeletonOriginals[containerId]) _skeletonOriginals[containerId] = el.innerHTML;
    let html = '<div class="skeleton-wrapper">';
    if (type === 'metrics-grid') {
        html += '<div class="skeleton-metric-grid">';
        for (let i = 0; i < 4; i++) html += '<div class="skeleton-metric-card"><div class="skeleton skeleton-label" style="width:60%;height:12px;margin-bottom:8px"></div><div class="skeleton skeleton-value" style="width:80%;height:24px;margin-bottom:6px"></div><div class="skeleton skeleton-text" style="width:40%;height:10px"></div></div>';
        html += '</div>';
    } else if (type === 'chart') {
        html += '<div class="skeleton skeleton-chart"></div>';
    } else if (type === 'table') {
        html += '<div class="skeleton-table">';
        for (let i = 0; i < 5; i++) html += '<div class="skeleton skeleton-row"></div>';
        html += '</div>';
    } else if (type === 'card') {
        html += '<div class="skeleton-metric-card"><div class="skeleton skeleton-label" style="width:50%;height:12px;margin-bottom:8px"></div><div class="skeleton skeleton-value" style="width:70%;height:20px"></div></div>';
    }
    html += '</div>';
    el.innerHTML = html;
}

function hideSkeleton(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const wrapper = el.querySelector('.skeleton-wrapper');
    if (wrapper) wrapper.remove();
    if (_skeletonOriginals[containerId] && !el.children.length) el.innerHTML = _skeletonOriginals[containerId];
    delete _skeletonOriginals[containerId];
}

// =============================================================================
// TOAST NOTIFICATION SYSTEM
// =============================================================================
let _toastContainer = null;

function showToast(message, type = 'info') {
    if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.className = 'gq-toast-container';
        document.body.appendChild(_toastContainer);
    }
    const toast = document.createElement('div');
    toast.className = `gq-toast ${type}`;
    toast.textContent = message;
    _toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('dismissing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// =============================================================================
// ERROR STATE MANAGER
// =============================================================================
const _errorOriginals = {};

function showErrorState(containerId, message, retryFn, detail) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!_errorOriginals[containerId]) _errorOriginals[containerId] = el.innerHTML;
    el.innerHTML = '<div class="error-state"><div class="error-state-icon">\u26A0</div>' +
        '<div class="error-state-message">' + (message || 'Something went wrong') + '</div>' +
        (detail ? '<div class="error-state-detail">' + detail + '</div>' : '') +
        (retryFn ? '<button class="error-state-retry">Retry</button>' : '') + '</div>';
    if (retryFn) {
        const btn = el.querySelector('.error-state-retry');
        if (btn) btn.addEventListener('click', retryFn);
    }
}

function hideErrorState(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (_errorOriginals[containerId]) { el.innerHTML = _errorOriginals[containerId]; delete _errorOriginals[containerId]; }
}

// =============================================================================
// FLASH-ON-CHANGE ANIMATION
// =============================================================================
function flashElement(el, direction) {
    const cls = direction === 'up' ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 800);
}

function flashValue(element, newValue, oldValue) {
    if (!element) return;
    const nv = typeof newValue === 'string' ? parseFloat(newValue.replace(/[$,+%]/g, '')) : newValue;
    const ov = typeof oldValue === 'string' ? parseFloat(oldValue.replace(/[$,+%]/g, '')) : oldValue;
    if (isNaN(nv) || isNaN(ov) || nv === ov) return;
    flashElement(element, nv > ov ? 'up' : 'down');
}

// =============================================================================
// SPARKLINE RENDERER
// =============================================================================
const _sparklineData = {};

function pushSparklineValue(key, value) {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return;
    if (!_sparklineData[key]) _sparklineData[key] = [];
    _sparklineData[key].push(num);
    if (_sparklineData[key].length > 30) _sparklineData[key].shift();
}

function renderSparkline(container, data, color) {
    if (!container || !data || data.length < 2) return;
    const w = 60, h = 24, pad = 1;
    const min = Math.min(...data), max = Math.max(...data), range = max - min || 1, eh = h - pad * 2;
    const pts = data.map((v, i) => ((i / (data.length - 1)) * w).toFixed(1) + ',' + (pad + eh - ((v - min) / range) * eh).toFixed(1));
    const lineColor = color || (data[data.length - 1] >= data[0] ? 'var(--color-profit)' : 'var(--color-loss)');
    const pStr = pts.join(' ');
    container.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polygon points="0,' + h + ' ' + pStr + ' ' + w + ',' + h + '" fill="' + lineColor + '" opacity="0.1"/><polyline points="' + pStr + '" fill="none" stroke="' + lineColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// =============================================================================
// ENHANCED SAFE FETCH (backward-compatible: returns parsed JSON or null)
// =============================================================================
const _inflightGets = {};

async function safeFetchJson(url, opts) {
    const method = (opts && opts.method) ? opts.method.toUpperCase() : 'GET';
    if (method === 'GET' && _inflightGets[url]) return _inflightGets[url];
    const execute = async () => {
        const delays = [1000, 2000];
        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                const fetchOpts = Object.assign({}, opts || {});
                if (!fetchOpts.signal) fetchOpts.signal = AbortSignal.timeout(10000);
                const res = await fetch(url, fetchOpts);
                if (!res.ok) { if (res.status >= 400 && res.status < 500) return null; throw new Error('server'); }
                return await res.json();
            } catch (err) { if (attempt < 2) await new Promise(r => setTimeout(r, delays[attempt])); }
        }
        return null;
    };
    if (method === 'GET') {
        const promise = execute().finally(() => delete _inflightGets[url]);
        _inflightGets[url] = promise;
        return promise;
    }
    return execute();
}

// =============================================================================
// VISIBILITY API — Pause/resume polling when tab hidden
// =============================================================================
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (livePriceInterval) { clearInterval(livePriceInterval); livePriceInterval = null; }
        if (tradingRefreshInterval) { clearInterval(tradingRefreshInterval); tradingRefreshInterval = null; }
        if (typeof _swingRefreshTimer !== 'undefined' && _swingRefreshTimer) { clearInterval(_swingRefreshTimer); _swingRefreshTimer = null; }
    } else {
        if (typeof startLivePricePolling === 'function' && optionsAnalysisTicker) startLivePricePolling();
        if (activeTab === 'tab-trading' && typeof startTradingRefresh === 'function') startTradingRefresh();
        if (typeof startSwingAutoRefresh === 'function') startSwingAutoRefresh();
    }
});

let _tradingLastLoad = 0;
async function loadTradingDashboard(force = false) {
    if (!force && Date.now() - _tradingLastLoad < 30000) return;
    _tradingLastLoad = Date.now();
    await Promise.all([
        loadPaperAccount(),
        loadPaperPositions(),
        loadPaperSignals(),
        loadPaperAnalytics(),
        loadPaperEquityCurve(),
        loadPaperJournal(),
        loadPaperConfig(),
        loadStrategyMatrix(),
        load0DTEDashboard(),
    ]);
}

async function refreshTradingDashboard() {
    await loadTradingDashboard(true);
}

// --- Account Summary ---
async function loadPaperAccount() {
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/account`);
        if (data && data.ok && data.data) {
            const d = data.data;
            const el = (id) => document.getElementById(id);

            const eqEl = el('trading-equity');
            const oldEq = eqEl.textContent;
            eqEl.textContent = '$' + d.equity.toLocaleString(undefined, {maximumFractionDigits: 0});
            flashValue(eqEl, d.equity, oldEq);

            el('trading-cash').textContent = '$' + d.cash.toLocaleString(undefined, {maximumFractionDigits: 0});
            el('trading-buying-power').textContent = '$' + d.buying_power.toLocaleString(undefined, {maximumFractionDigits: 0});

            const pnlEl = el('trading-total-pnl');
            const oldPnl = pnlEl.textContent;
            pnlEl.textContent = (d.total_pnl >= 0 ? '+' : '') + '$' + d.total_pnl.toLocaleString(undefined, {maximumFractionDigits: 0});
            pnlEl.className = 'trading-metric-value ' + (d.total_pnl >= 0 ? 'positive' : 'negative');
            flashValue(pnlEl, d.total_pnl, oldPnl);

            const dailyEl = el('trading-daily-pnl');
            const oldDaily = dailyEl.textContent;
            const daily = d.daily_pnl || 0;
            dailyEl.textContent = (daily >= 0 ? '+' : '') + '$' + daily.toLocaleString(undefined, {maximumFractionDigits: 0});
            dailyEl.className = 'trading-metric-value ' + (daily >= 0 ? 'positive' : 'negative');
            flashValue(dailyEl, daily, oldDaily);
            pushSparklineValue('daily-pnl', daily);
            const dailySpark = document.getElementById('sparkline-daily-pnl');
            if (dailySpark && _sparklineData['daily-pnl']) renderSparkline(dailySpark, _sparklineData['daily-pnl']);

            // Sparkline for equity
            pushSparklineValue('equity', d.equity);
            const eqSpark = document.getElementById('sparkline-equity');
            if (eqSpark && _sparklineData.equity) renderSparkline(eqSpark, _sparklineData.equity);

            // Status badge
            const statusEl = el('trading-status');
            if (d.account_number && d.account_number !== 'offline') {
                statusEl.textContent = '● LIVE';
                statusEl.className = 'trading-status-badge live';
            } else {
                statusEl.textContent = '● OFFLINE';
                statusEl.className = 'trading-status-badge offline';
            }
        }
    } catch (e) { console.error('Paper account error:', e); }
}

// --- OCC Symbol Builder ---
function buildOccSymbol(ticker, expiration, strike, optionType) {
    // OCC format: "TICKER  YYMMDDTSSSSSSSS" (6-char padded, 6-digit date, type, 8-digit strike*1000)
    if (!ticker || !expiration || !strike || !optionType) return null;
    const padded = (ticker + '      ').slice(0, 6);
    const dateParts = expiration.replace(/-/g, '');  // "2026-03-20" → "20260320"
    const dateStr = dateParts.slice(2);  // → "260320"
    const typeChar = optionType.toLowerCase() === 'put' ? 'P' : 'C';
    const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
    return padded + dateStr + typeChar + strikeStr;
}

// --- Positions ---
async function loadPaperPositions() {
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/positions`);
        const container = document.getElementById('trading-positions');
        if (!data || !data.ok || !data.data) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">No position data</div>';
            return;
        }

        const trades = data.data.journal_trades || [];
        const positions = data.data.positions || [];
        const liveMarks = data.data.marks || {};

        if (trades.length === 0 && positions.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">No open positions</div>';
            return;
        }

        // Portfolio greeks accumulators for intel strip
        let portfolioDelta = 0, portfolioTheta = 0, portfolioGamma = 0;
        const positionTickers = new Set();

        let html = '<table class="trading-table"><thead><tr>';
        html += '<th>Ticker</th><th>Strategy</th><th>Type</th><th>Strike</th><th>Exp</th><th>Qty</th><th>Entry</th><th>Current</th><th>P&L</th><th title="Position delta">Delta</th><th title="Daily theta decay">Theta</th><th title="Distance to stop loss / take profit">Exit Zone</th><th>Action</th>';
        html += '</tr></thead><tbody>';

        for (const trade of trades) {
            const entry = trade.entry_price || 0;
            let current = entry;
            let pnl = 0;
            let pnlPct = 0;

            let allMarksZero = true;
            if (trade.is_multi_leg && trade.legs && trade.legs.length > 1) {
                // Multi-leg: calculate net mark from all leg positions
                let netMark = 0;
                let allLegsFound = true;
                for (const leg of trade.legs) {
                    // Build OCC symbol: "TICKER  YYMMDDTSSSSSSSS"
                    const legOcc = buildOccSymbol(trade.ticker, leg.expiration, leg.strike, leg.option_type);
                    // Also check occ_symbols array as fallback
                    const occToFind = legOcc || (trade.occ_symbols || []).find(s => {
                        const strikeStr = String(Math.round(leg.strike * 1000)).padStart(8, '0');
                        const typeChar = leg.option_type === 'put' ? 'P' : 'C';
                        return s && s.includes(typeChar + strikeStr);
                    });
                    const legPos = occToFind ? positions.find(p => p.symbol === occToFind) : null;
                    // Try cert position mark, then prod live marks fallback
                    let legMark = 0;
                    if (legPos) {
                        legMark = legPos.mark || legPos.close_price || 0;
                    }
                    if (legMark === 0 && occToFind && liveMarks[occToFind]) {
                        legMark = liveMarks[occToFind];
                    }
                    if (legMark > 0) {
                        allMarksZero = false;
                        if (leg.action === 'SELL') netMark += legMark;
                        else netMark -= legMark;
                    } else {
                        allLegsFound = false;
                    }
                }
                if (allLegsFound && entry > 0 && !allMarksZero) {
                    // Credit spread: PnL = (credit_received - cost_to_close) / credit * 100
                    current = netMark;
                    pnlPct = ((entry - netMark) / entry) * 100;
                    pnl = (entry - netMark) * (trade.quantity || 1) * 100;
                } else {
                    // Marks stale/zero — signal NaN to render "--"
                    pnlPct = NaN;
                }
            } else {
                // Single-leg trade
                const matchPos = positions.find(p => p.symbol && trade.occ_symbol && p.symbol === trade.occ_symbol);
                let rawMark = matchPos ? (matchPos.mark || matchPos.close_price || 0) : 0;
                if (rawMark === 0 && trade.occ_symbol && liveMarks[trade.occ_symbol]) {
                    rawMark = liveMarks[trade.occ_symbol];
                }
                if (rawMark > 0) allMarksZero = false;
                current = rawMark > 0 ? rawMark : entry;
                if (allMarksZero) {
                    pnlPct = NaN;
                } else {
                    pnl = trade.direction === 'long'
                        ? (current - entry) * (trade.quantity || 1) * 100
                        : (entry - current) * (trade.quantity || 1) * 100;
                    pnlPct = entry > 0 ? ((trade.direction === 'long' ? current - entry : entry - current) / entry * 100) : 0;
                }
            }

            const pnlClass = isNaN(pnlPct) ? '' : (pnl >= 0 ? 'pnl-positive' : 'pnl-negative');
            const pnlSign = isNaN(pnlPct) ? '' : (pnl >= 0 ? '+' : '');
            const pnlDisplay = isNaN(pnlPct) ? '--' : `${pnlSign}$${pnl.toFixed(0)} (${pnlSign}${pnlPct.toFixed(1)}%)`;
            const currentDisplay = isNaN(pnlPct) ? '--' : `$${current.toFixed(2)}`;

            const expShort = trade.expiration ? trade.expiration.slice(5) : '--';
            const strategy = trade.strategy || trade.strategy_name || trade.signal_type || 'Manual';
            positionTickers.add(trade.ticker);

            // Extract greeks from position data
            let posDelta = null, posTheta = null, posGamma = null;
            if (trade.is_multi_leg && trade.legs && trade.legs.length > 1) {
                let netD = 0, netT = 0, netG = 0, hasGreeks = false;
                for (const leg of trade.legs) {
                    const legOcc = buildOccSymbol(trade.ticker, leg.expiration, leg.strike, leg.option_type);
                    const legPos = legOcc ? positions.find(p => p.symbol === legOcc) : null;
                    if (legPos) {
                        const qty = (leg.quantity || 1) * (trade.quantity || 1);
                        const sign = leg.action === 'BUY' ? 1 : -1;
                        if (legPos.delta != null) { netD += legPos.delta * qty * sign; hasGreeks = true; }
                        if (legPos.theta != null) { netT += legPos.theta * qty * sign; hasGreeks = true; }
                        if (legPos.gamma != null) { netG += legPos.gamma * qty * sign; hasGreeks = true; }
                    }
                }
                if (hasGreeks) { posDelta = netD; posTheta = netT; posGamma = netG; }
                // Fallback: use entry-time greeks from journal when position-level unavailable
                if (!hasGreeks && trade.greeks) {
                    const qty = trade.quantity || 1;
                    if (trade.greeks.delta != null) posDelta = trade.greeks.delta * qty;
                    if (trade.greeks.theta != null) posTheta = trade.greeks.theta * qty;
                    if (trade.greeks.gamma != null) posGamma = trade.greeks.gamma * qty;
                }
            } else {
                const matchPos = positions.find(p => p.symbol && trade.occ_symbol && p.symbol === trade.occ_symbol);
                if (matchPos) {
                    const qty = trade.quantity || 1;
                    const sign = trade.direction === 'long' ? 1 : -1;
                    if (matchPos.delta != null) posDelta = matchPos.delta * qty * sign;
                    if (matchPos.theta != null) posTheta = matchPos.theta * qty * sign;
                    if (matchPos.gamma != null) posGamma = matchPos.gamma * qty * sign;
                }
                // Fallback: use entry-time greeks from journal
                if (posDelta == null && trade.greeks) {
                    const qty = trade.quantity || 1;
                    const sign = trade.direction === 'long' ? 1 : -1;
                    if (trade.greeks.delta != null) posDelta = trade.greeks.delta * qty * sign;
                    if (trade.greeks.theta != null) posTheta = trade.greeks.theta * qty * sign;
                    if (trade.greeks.gamma != null) posGamma = trade.greeks.gamma * qty * sign;
                }
            }

            // Accumulate portfolio greeks
            if (posDelta != null) portfolioDelta += posDelta;
            if (posTheta != null) portfolioTheta += posTheta;
            if (posGamma != null) portfolioGamma += posGamma;

            const deltaStr = posDelta != null ? posDelta.toFixed(2) : '--';
            const thetaStr = posTheta != null ? `$${(posTheta * 100).toFixed(0)}` : '--';
            const deltaColor = posDelta != null ? (posDelta >= 0 ? 'color:var(--green)' : 'color:var(--red)') : '';
            const thetaColor = posTheta != null ? (posTheta >= 0 ? 'color:var(--green)' : 'color:var(--red)') : '';

            // Exit zone progress bar
            const slPct = trade.stop_loss_pct || -50;
            const tpPct = trade.take_profit_pct || 100;
            let exitZoneHtml = '--';
            if (!isNaN(pnlPct)) {
                const totalRange = tpPct - slPct;
                const pctInRange = ((pnlPct - slPct) / totalRange) * 100;
                const clampedPct = Math.max(0, Math.min(100, pctInRange));
                const fillClass = pnlPct >= 0 ? 'profit' : 'loss';
                const zoneLabel = pnlPct >= 0 ? `+${pnlPct.toFixed(0)}%` : `${pnlPct.toFixed(0)}%`;
                exitZoneHtml = `<div class="exit-zone-bar">
                    <div class="exit-zone-track">
                        <div class="exit-zone-fill ${fillClass}" style="width:${clampedPct}%"></div>
                    </div>
                    <span class="exit-zone-label">${zoneLabel}</span>
                </div>`;
            }

            if (trade.is_multi_leg && trade.legs && trade.legs.length > 1) {
                // Multi-leg trade display
                const legsStr = trade.legs.map(l =>
                    `${l.action === 'BUY' ? '+' : '-'}${l.quantity || 1} ${l.option_type.charAt(0).toUpperCase()} $${l.strike}`
                ).join(' / ');
                const maxLoss = trade.max_loss ? `$${trade.max_loss.toLocaleString()}` : '--';
                const maxProfit = trade.max_profit && trade.max_profit < 999999 ? `$${trade.max_profit.toLocaleString()}` : '∞';

                html += `<tr>
                    <td style="font-weight: 700;">${trade.ticker}</td>
                    <td><span style="font-size: 0.65rem; color: var(--primary); font-weight: 600;">${strategy}</span></td>
                    <td style="font-size: 0.65rem;">${legsStr}</td>
                    <td style="font-size: 0.65rem;">ML:${maxLoss}</td>
                    <td>${expShort}</td>
                    <td>${trade.quantity || 1}</td>
                    <td>$${entry.toFixed(2)}</td>
                    <td>${currentDisplay}</td>
                    <td class="${pnlClass}">${pnlDisplay}</td>
                    <td style="font-size:0.75rem;${deltaColor}">${deltaStr}</td>
                    <td style="font-size:0.75rem;${thetaColor}">${thetaStr}</td>
                    <td>${exitZoneHtml}</td>
                    <td><button class="close-btn" onclick="closePaperPosition('${trade.id}')">Close</button></td>
                </tr>`;
            } else {
                // Single-leg trade display (original)
                html += `<tr>
                    <td style="font-weight: 700;">${trade.ticker}</td>
                    <td><span style="font-size: 0.7rem; color: var(--text-muted);">${strategy}</span></td>
                    <td>${trade.direction === 'long' ? '▲' : '▼'} ${(trade.option_type || 'call').charAt(0).toUpperCase()}</td>
                    <td>$${(trade.strike || 0).toLocaleString()}</td>
                    <td>${expShort}</td>
                    <td>${trade.quantity || 1}</td>
                    <td>$${entry.toFixed(2)}</td>
                    <td>${currentDisplay}</td>
                    <td class="${pnlClass}">${pnlDisplay}</td>
                    <td style="font-size:0.75rem;${deltaColor}">${deltaStr}</td>
                    <td style="font-size:0.75rem;${thetaColor}">${thetaStr}</td>
                    <td>${exitZoneHtml}</td>
                    <td><button class="close-btn" onclick="closePaperPosition('${trade.id}')">Close</button></td>
                </tr>`;
            }
        }

        html += '</tbody></table>';
        container.innerHTML = html;

        // Update portfolio intelligence strip with accumulated greeks
        updatePortfolioIntelStrip(portfolioDelta, portfolioTheta, portfolioGamma, positionTickers);
    } catch (e) {
        console.error('Paper positions error:', e);
    }
}

// --- Signals ---
async function loadPaperSignals() {
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/signals`);
        const container = document.getElementById('trading-signals');
        if (!data || !data.ok || !data.data || data.data.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">No active signals</div>';
            return;
        }

        let html = '';
        for (const sig of data.data) {
            const conf = sig.confidence || 0;
            const confClass = conf >= 70 ? 'high-conf' : conf >= 50 ? 'mid-conf' : 'low-conf';
            const confColor = conf >= 70 ? 'var(--green)' : conf >= 50 ? 'var(--orange)' : 'var(--red)';
            const arrow = sig.direction === 'long' ? '▲' : '▼';
            const signalLabel = (sig.signal_type || '').replace(/_/g, ' ').toUpperCase();

            html += `<div class="signal-card ${confClass}">
                <div class="signal-card-header">
                    <div>
                        <span class="signal-card-ticker">${arrow} ${sig.ticker}</span>
                        <span class="signal-card-type" style="margin-left: 8px;">${signalLabel}</span>
                    </div>
                    <span class="signal-card-confidence" style="color: ${confColor};">${conf}%</span>
                </div>
                <div class="signal-card-detail">${sig.notes || ''}</div>
            </div>`;
        }
        container.innerHTML = html;
    } catch (e) { console.error('Paper signals error:', e); }
}

// --- Analytics ---
async function loadPaperAnalytics() {
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/analytics`);
        if (!data || !data.ok || !data.data) return;
        const d = data.data;
        const el = (id) => document.getElementById(id);

        const set = (id, text, cls) => { const e = el(id); if (e) { e.textContent = text; if (cls) e.className = 'trading-metric-value ' + cls; } };
        set('perf-win-rate', (d.win_rate || 0) + '%', d.win_rate >= 50 ? 'positive' : d.win_rate > 0 ? 'negative' : '');
        set('perf-profit-factor', d.profit_factor >= 999 ? '∞' : (d.profit_factor || 0), d.profit_factor >= 1.5 ? 'positive' : d.profit_factor > 0 ? 'negative' : '');
        set('perf-sharpe', d.sharpe_ratio || 0, d.sharpe_ratio >= 1 ? 'positive' : d.sharpe_ratio > 0 ? '' : 'negative');
        set('perf-max-dd', '-' + (d.max_drawdown_pct || 0) + '%', 'negative');
        set('perf-expectancy', '$' + (d.expectancy || 0).toFixed(0), d.expectancy >= 0 ? 'positive' : 'negative');
        set('perf-avg-win', '+$' + (d.avg_win || 0).toFixed(0), 'positive');
        set('perf-avg-loss', '-$' + Math.abs(d.avg_loss || 0).toFixed(0), 'negative');
        set('perf-total-trades', d.total_trades || 0, '');

        // Strategy breakdown
        renderStrategyBreakdown(d.strategy_breakdown || {});

        // Signal attribution
        renderSignalAttribution(d.signal_attribution || {});

    } catch (e) { console.error('Paper analytics error:', e); }
}

function renderStrategyBreakdown(breakdown) {
    const container = document.getElementById('trading-strategy-breakdown');
    if (!breakdown || Object.keys(breakdown).length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">No strategy data yet</div>';
        return;
    }

    let html = '';
    const sorted = Object.entries(breakdown).sort((a, b) => b[1].total_pnl - a[1].total_pnl);
    for (const [name, stats] of sorted) {
        const pnlClass = stats.total_pnl >= 0 ? 'positive' : 'negative';
        const pnlSign = stats.total_pnl >= 0 ? '+' : '';
        html += `<div class="strategy-card">
            <div class="strategy-card-header">
                <span class="strategy-card-name">${name}</span>
                <span class="trading-metric-value ${pnlClass}" style="font-size: 0.85rem;">${pnlSign}$${stats.total_pnl.toLocaleString()}</span>
            </div>
            <div class="strategy-card-stats">
                <div class="strategy-stat"><div class="strategy-stat-value">${stats.win_rate}%</div><div class="strategy-stat-label">Win Rate</div></div>
                <div class="strategy-stat"><div class="strategy-stat-value">${stats.profit_factor >= 999 ? '∞' : stats.profit_factor}</div><div class="strategy-stat-label">P.Factor</div></div>
                <div class="strategy-stat"><div class="strategy-stat-value">${stats.count}</div><div class="strategy-stat-label">Trades</div></div>
                <div class="strategy-stat"><div class="strategy-stat-value">$${stats.expectancy.toFixed(0)}</div><div class="strategy-stat-label">Expect.</div></div>
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

function renderSignalAttribution(attribution) {
    const container = document.getElementById('trading-signal-attribution');
    if (!attribution || Object.keys(attribution).length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">No signal data yet</div>';
        return;
    }

    const colors = {
        'gex_flip': 'var(--orange)',
        'regime_shift': 'var(--purple)',
        'macro_event': 'var(--blue)',
        'iv_reversion': 'var(--cyan)',
        'manual': 'var(--text-muted)',
    };

    let html = '';
    for (const [type, stats] of Object.entries(attribution)) {
        const color = colors[type] || 'var(--text-muted)';
        const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const pnlSign = stats.total_pnl >= 0 ? '+' : '';
        const pnlClass = stats.total_pnl >= 0 ? 'positive' : 'negative';

        html += `<div class="attribution-bar">
            <div class="attribution-bar-header">
                <span style="font-weight: 600;">${label}</span>
                <span>${stats.count} trades | ${stats.win_rate}% WR | <span class="${pnlClass}" style="font-weight: 600;">${pnlSign}$${stats.total_pnl.toLocaleString()}</span></span>
            </div>
            <div class="attribution-bar-fill">
                <div class="attribution-bar-fill-inner" style="width: ${Math.min(stats.win_rate, 100)}%; background: ${color};"></div>
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

// --- Strategy x Regime Matrix ---
function _srmFormatRegime(regime) {
    if (!regime) return 'Unknown';
    return regime.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function _srmRegimeClass(regime) {
    if (!regime) return '';
    if (regime.includes('opportunity') || regime.includes('melt_up')) return 'regime-bullish';
    if (regime.includes('danger') || regime.includes('high_risk')) return 'regime-bearish';
    if (regime.includes('volatile')) return 'regime-volatile';
    return 'regime-neutral';
}

async function loadStrategyMatrix() {
    const container = document.getElementById('strategy-matrix-body');
    if (!container) return;
    container.innerHTML = '<div class="srm-empty">Loading matrix...</div>';

    try {
        const journalRes = await safeFetchJson(`${API_BASE}/paper/journal?limit=500`);
        if (!journalRes || !journalRes.ok || !journalRes.data) {
            container.innerHTML = '<div class="srm-empty">No journal data available</div>';
            return;
        }

        const entries = Array.isArray(journalRes.data) ? journalRes.data : (journalRes.data.entries || []);
        const closed = entries.filter(e => e.status === 'closed' && e.pnl_dollars != null);

        if (closed.length === 0) {
            container.innerHTML = '<div class="srm-empty">No closed trades to analyze yet</div>';
            return;
        }

        // Helpers
        const simplifyStrategy = s => s ? s.replace(/\s*\(.*\)$/, '') || s : 'Unknown';
        const getRegime = e => (e.regime_at_entry && e.regime_at_entry.combined_regime) || null;

        // Build data structures
        const tickerStats = {}, strategyStats = {}, matrix = {};
        const allRegimes = new Set(), allStrategies = new Set();

        for (const e of closed) {
            const ticker = e.ticker, pnl = e.pnl_dollars, isWin = pnl >= 0;
            const strategy = simplifyStrategy(e.strategy_name || e.strategy);
            const regime = getRegime(e);

            // Per ticker
            if (!tickerStats[ticker]) tickerStats[ticker] = { wins: 0, losses: 0, pnl: 0 };
            if (isWin) tickerStats[ticker].wins++; else tickerStats[ticker].losses++;
            tickerStats[ticker].pnl += pnl;

            // Per strategy
            if (!strategyStats[strategy]) strategyStats[strategy] = { wins: 0, losses: 0, pnl: 0 };
            if (isWin) strategyStats[strategy].wins++; else strategyStats[strategy].losses++;
            strategyStats[strategy].pnl += pnl;

            // Matrix: strategy × regime
            if (regime) {
                allRegimes.add(regime);
                allStrategies.add(strategy);
                if (!matrix[strategy]) matrix[strategy] = {};
                if (!matrix[strategy][regime]) matrix[strategy][regime] = { wins: 0, losses: 0, pnl: 0 };
                const cell = matrix[strategy][regime];
                if (isWin) cell.wins++; else cell.losses++;
                cell.pnl += pnl;
            }
        }

        // Totals
        const totalWins = closed.filter(e => e.pnl_dollars >= 0).length;
        const totalPnl = closed.reduce((s, e) => s + (e.pnl_dollars || 0), 0);
        const overallWr = ((totalWins / closed.length) * 100).toFixed(0);
        const latestRegime = getRegime(entries[0]) || 'unknown';

        // --- Build HTML ---
        let html = '';

        // 1. Overview strip
        html += `<div class="srm-overview">
            <div class="srm-overview-item">
                <span class="srm-overview-label">Current Regime</span>
                <span class="srm-overview-value srm-regime-tag">${_srmFormatRegime(latestRegime)}</span>
            </div>
            <div class="srm-overview-item">
                <span class="srm-overview-label">Win Rate</span>
                <span class="srm-overview-value" style="color:${overallWr >= 60 ? 'var(--green)' : 'var(--red)'}">${overallWr}%</span>
            </div>
            <div class="srm-overview-item">
                <span class="srm-overview-label">Total P&L</span>
                <span class="srm-overview-value" style="color:${totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">$${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString()}</span>
            </div>
            <div class="srm-overview-item">
                <span class="srm-overview-label">Closed Trades</span>
                <span class="srm-overview-value">${closed.length}</span>
            </div>
        </div>`;

        // 2. Ticker performance grid
        const sortedTickers = Object.entries(tickerStats).sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));
        html += '<div class="srm-section-title">PERFORMANCE BY TICKER</div>';
        html += '<div class="srm-ticker-grid">';
        for (const [ticker, stats] of sortedTickers) {
            const total = stats.wins + stats.losses;
            const wr = ((stats.wins / total) * 100).toFixed(0);
            const wrColor = wr >= 80 ? 'var(--green)' : wr >= 50 ? 'var(--yellow)' : 'var(--red)';
            const pnlColor = stats.pnl >= 0 ? 'var(--green)' : 'var(--red)';
            html += `<div class="srm-ticker-card">
                <div class="srm-ticker-name">${ticker}</div>
                <div class="srm-ticker-wr" style="color:${wrColor}">${wr}%</div>
                <div class="srm-ticker-bar-track"><div class="srm-ticker-bar-fill" style="width:${wr}%;background:${wrColor};"></div></div>
                <div class="srm-ticker-details">
                    <span>${stats.wins}W/${stats.losses}L</span>
                    <span style="color:${pnlColor}">$${stats.pnl >= 0 ? '+' : ''}${stats.pnl.toLocaleString()}</span>
                </div>
            </div>`;
        }
        html += '</div>';

        // 3. Regime matrix table
        if (allRegimes.size > 0 && allStrategies.size > 0) {
            const regimes = [...allRegimes].sort();
            const strategies = [...allStrategies].sort((a, b) => {
                const tA = regimes.reduce((s, r) => { const c = matrix[a] && matrix[a][r]; return s + (c ? c.wins + c.losses : 0); }, 0);
                const tB = regimes.reduce((s, r) => { const c = matrix[b] && matrix[b][r]; return s + (c ? c.wins + c.losses : 0); }, 0);
                return tB - tA;
            });

            // Best per regime
            const bestPerRegime = {};
            for (const regime of regimes) {
                let best = { strategy: null, wr: -1, total: 0 };
                for (const strategy of strategies) {
                    const c = matrix[strategy] && matrix[strategy][regime];
                    if (!c) continue;
                    const total = c.wins + c.losses;
                    const wr = total > 0 ? c.wins / total : 0;
                    if (wr > best.wr || (wr === best.wr && total > best.total)) best = { strategy, wr, total };
                }
                if (best.strategy) bestPerRegime[regime] = best.strategy;
            }

            html += '<div class="srm-section-title" style="margin-top:14px;">REGIME HEATMAP</div>';
            html += '<table class="srm-matrix-table"><thead><tr><th>Strategy</th>';
            for (const regime of regimes) html += `<th>${_srmFormatRegime(regime)}</th>`;
            html += '<th>Total</th></tr></thead><tbody>';

            for (const strategy of strategies) {
                html += `<tr><td class="srm-strategy-name">${strategy}</td>`;
                let stW = 0, stL = 0, stP = 0;
                for (const regime of regimes) {
                    const c = matrix[strategy] && matrix[strategy][regime];
                    if (!c || (c.wins + c.losses) === 0) {
                        html += '<td class="srm-cell-empty">&mdash;</td>';
                    } else {
                        const total = c.wins + c.losses;
                        const wr = ((c.wins / total) * 100).toFixed(0);
                        const isBest = bestPerRegime[regime] === strategy;
                        const hue = Math.round((wr / 100) * 120);
                        stW += c.wins; stL += c.losses; stP += c.pnl;
                        html += `<td><div class="srm-matrix-cell${isBest ? ' srm-cell-best' : ''}" style="background:hsla(${hue},70%,50%,0.12);">
                            <span class="srm-cell-wr" style="color:hsl(${hue},70%,60%)">${wr}%</span>
                            <span class="srm-cell-count">${total} trade${total !== 1 ? 's' : ''}</span>
                            <span class="srm-cell-pnl" style="color:${c.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">$${c.pnl >= 0 ? '+' : ''}${c.pnl.toLocaleString()}</span>
                        </div></td>`;
                    }
                }
                // Total column
                const stT = stW + stL;
                if (stT > 0) {
                    const stWr = ((stW / stT) * 100).toFixed(0);
                    html += `<td><div class="srm-matrix-cell srm-cell-total">
                        <span class="srm-cell-wr">${stWr}%</span>
                        <span class="srm-cell-count">${stT}</span>
                        <span class="srm-cell-pnl" style="color:${stP >= 0 ? 'var(--green)' : 'var(--red)'}">$${stP >= 0 ? '+' : ''}${stP.toLocaleString()}</span>
                    </div></td>`;
                }
                html += '</tr>';
            }
            html += '</tbody></table>';
        }

        container.innerHTML = html;

        // Update header badge
        const badgeEl = document.getElementById('srm-regime-badge');
        if (badgeEl) {
            badgeEl.textContent = _srmFormatRegime(latestRegime);
            badgeEl.className = 'srm-regime-badge ' + _srmRegimeClass(latestRegime);
        }

    } catch (e) {
        console.error('Strategy matrix error:', e);
        container.innerHTML = `<div class="srm-empty" style="color:var(--red);">
            Failed to load matrix. <button class="btn btn-ghost" onclick="loadStrategyMatrix()" style="padding:2px 8px;font-size:0.7rem;margin-left:8px;">Retry</button>
        </div>`;
    }
}

// --- Equity Curve ---
async function loadPaperEquityCurve() {
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/equity-curve`);
        if (!data || !data.ok || !data.data || data.data.length === 0) return;

        const dates = data.data.map(d => d.date);
        const equities = data.data.map(d => d.equity);
        const startingCapital = data.data.length > 0 ? data.data[0].equity : 50000;

        const chartEl = document.getElementById('trading-equity-chart');
        if (!chartEl) return;

        if (tradingEquityChart) {
            tradingEquityChart.updateSeries([{ name: 'Equity', data: equities }]);
            tradingEquityChart.updateOptions({ xaxis: { categories: dates } });
            return;
        }

        tradingEquityChart = new ApexCharts(chartEl, {
            series: [{ name: 'Equity', data: equities }],
            chart: {
                type: 'area',
                height: 280,
                background: 'transparent',
                toolbar: { show: false },
                fontFamily: 'Inter, sans-serif',
            },
            colors: ['#22c55e'],
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] },
            },
            stroke: { curve: 'smooth', width: 2 },
            xaxis: {
                categories: dates,
                labels: { style: { colors: '#71717a', fontSize: '10px' }, rotate: -45 },
                axisBorder: { show: false },
                axisTicks: { show: false },
            },
            yaxis: {
                labels: {
                    style: { colors: '#71717a', fontSize: '10px' },
                    formatter: v => '$' + (v / 1000).toFixed(1) + 'K',
                },
            },
            grid: { borderColor: '#2a2a3a', strokeDashArray: 3 },
            tooltip: {
                theme: 'dark',
                y: { formatter: v => '$' + v.toLocaleString(undefined, {maximumFractionDigits: 0}) },
            },
            annotations: {
                yaxis: [{
                    y: startingCapital,
                    borderColor: '#71717a',
                    strokeDashArray: 4,
                    label: {
                        text: 'Starting Capital',
                        style: { color: '#71717a', background: 'transparent', fontSize: '10px' },
                        position: 'left',
                    },
                }],
            },
        });
        tradingEquityChart.render();
    } catch (e) { console.error('Equity curve error:', e); }
}

// --- Journal ---
async function loadPaperJournal() {
    try {
        const qp = new URLSearchParams({ limit: '30' });
        if (journalFilter !== 'all') qp.set('status', journalFilter);
        const data = await safeFetchJson(`${API_BASE}/paper/journal?${qp.toString()}`);
        const container = document.getElementById('trading-journal');

        if (!data || !data.ok || !data.data || data.data.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">No trades yet</div>';
            return;
        }

        let html = '<table class="trading-table"><thead><tr>';
        html += '<th>Date</th><th>Ticker</th><th>Strategy</th><th>Signal</th><th>Dir</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Reason</th>';
        html += '</tr></thead><tbody>';

        // Show newest first
        const trades = [...data.data].reverse();
        for (const t of trades) {
            const dateStr = t.entry_time ? t.entry_time.slice(0, 10) : '--';
            const strategy = t.strategy || t.signal_type || 'Manual';
            const signalLabel = (t.signal_type || '').replace(/_/g, ' ');
            const dir = t.direction === 'long' ? '▲ Long' : '▼ Short';
            const entry = t.entry_price ? '$' + t.entry_price.toFixed(2) : '--';
            const exit = t.exit_price ? '$' + t.exit_price.toFixed(2) : '--';
            const pnl = t.pnl_dollars != null ? t.pnl_dollars : null;
            const pnlStr = pnl != null ? (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(0) : '--';
            const pnlPctStr = t.pnl_pct != null ? ` (${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(1)}%)` : '';
            const pnlClass = pnl != null ? (pnl >= 0 ? 'pnl-positive' : 'pnl-negative') : '';
            let reason = t.exit_reason ? t.exit_reason.replace(/_/g, ' ') : (t.status === 'open' ? 'OPEN' : '--');
            // Fix misleading reason: stop_loss with positive P&L was from mark=0 bug
            if (t.exit_reason && t.exit_reason.startsWith('stop_loss') && pnl != null && pnl > 0) {
                reason = 'auto close';
            }

            html += `<tr>
                <td>${dateStr}</td>
                <td style="font-weight: 700;">${t.ticker}</td>
                <td><span style="font-size: 0.7rem; color: var(--text-muted);">${strategy}</span></td>
                <td style="font-size: 0.72rem;">${signalLabel}</td>
                <td>${dir}</td>
                <td>${entry}</td>
                <td>${exit}</td>
                <td class="${pnlClass}">${pnlStr}${pnlPctStr}</td>
                <td style="font-size: 0.72rem; color: var(--text-muted);">${reason}</td>
            </tr>`;
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) { console.error('Paper journal error:', e); }
}

function filterJournal(filter) {
    journalFilter = filter;
    document.querySelectorAll('.journal-filter').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.journal-filter[data-filter="${filter}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    loadPaperJournal();
}

// --- Config ---
async function loadPaperConfig() {
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/config`);
        if (!data || !data.ok || !data.data) return;
        const c = data.data;

        // Update auto-trade toggle
        const toggle = document.getElementById('auto-trade-toggle');
        if (toggle) toggle.checked = c.auto_trade_enabled || false;

        // Update multi-leg toggle
        const mlToggle = document.getElementById('multi-leg-toggle');
        if (mlToggle) mlToggle.checked = c.multi_leg_enabled || false;

        // Update risk mode toggle
        const rmToggle = document.getElementById('risk-mode-toggle');
        const rmLabel = document.getElementById('risk-mode-label');
        if (rmToggle) {
            rmToggle.checked = (c.risk_mode === 'all');
            if (rmLabel) rmLabel.textContent = rmToggle.checked ? 'All Risk' : 'Limited Risk';
        }

        // Render risk config
        const container = document.getElementById('trading-risk');
        container.innerHTML = `
            <div class="risk-item"><span class="risk-item-label">Max Positions</span><span class="risk-item-value">${c.max_positions || 5}</span></div>
            <div class="risk-item"><span class="risk-item-label">Max Position Size</span><span class="risk-item-value">${c.max_position_pct || 5}%</span></div>
            <div class="risk-item"><span class="risk-item-label">Max Exposure</span><span class="risk-item-value">${c.max_exposure_pct || 30}%</span></div>
            <div class="risk-item"><span class="risk-item-label">Max Daily Trades</span><span class="risk-item-value">${c.max_daily_trades || 10}</span></div>
            <div class="risk-item"><span class="risk-item-label">Max Daily Loss</span><span class="risk-item-value">-${c.max_daily_loss_pct || 5}%</span></div>
            <div class="risk-item"><span class="risk-item-label">Stop Loss</span><span class="risk-item-value">${c.stop_loss_pct || -50}%</span></div>
            <div class="risk-item"><span class="risk-item-label">Take Profit</span><span class="risk-item-value">+${c.take_profit_pct || 100}%</span></div>
            <div class="risk-item"><span class="risk-item-label">Min DTE</span><span class="risk-item-value">${c.min_dte_to_open || 14}d</span></div>
            <div class="risk-item"><span class="risk-item-label">Time Exit</span><span class="risk-item-value">${c.time_exit_dte || 7} DTE</span></div>
            <div class="risk-item"><span class="risk-item-label">Min Confidence</span><span class="risk-item-value">${c.min_confidence || 60}%</span></div>
            <div class="risk-item"><span class="risk-item-label">Watched Tickers</span><span class="risk-item-value">${(c.watched_tickers || []).join(', ')}</span></div>
        `;
    } catch (e) { console.error('Paper config error:', e); }
}

// --- Actions ---
async function triggerSignalCheck(evt) {
    const btn = evt ? evt.target : document.querySelector('[onclick*="triggerSignalCheck"]');
    try {
        btn.disabled = true;
        btn.textContent = 'Checking...';
        const res = await fetch(`${API_BASE}/paper/check-signals`, { method: 'POST' });
        const data = await res.json();
        btn.disabled = false;
        btn.textContent = 'Check Signals';
        if (data.ok) {
            const d = data.data;
            const sigs = d.signals?.length || 0;
            const exec = d.executed?.length || 0;
            const exits = d.exits?.length || 0;
            const failed = d.failed?.length || 0;
            showToast(`Signals: ${sigs} found, ${exec} executed`, exec > 0 ? 'success' : 'info');
            // Show result as status badge
            const status = document.getElementById('trading-status');
            if (status) {
                const oldText = status.textContent;
                status.textContent = `✓ ${sigs} signals, ${exec} executed, ${failed} failed`;
                status.style.color = exec > 0 ? 'var(--green)' : failed > 0 ? 'var(--orange)' : 'var(--text-muted)';
                setTimeout(() => { status.textContent = oldText; status.style.color = ''; }, 5000);
            }
            await loadTradingDashboard(true);
        } else {
            const status = document.getElementById('trading-status');
            if (status) {
                status.textContent = `✗ ${data.error || 'Signal check failed'}`;
                status.style.color = 'var(--red)';
                setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 5000);
            }
        }
    } catch (e) {
        console.error('Signal check error:', e);
        btn.disabled = false;
        btn.textContent = 'Check Signals';
    }
}

async function closePaperPosition(tradeId) {
    if (!confirm('Close this position?')) return;
    try {
        const res = await fetch(`${API_BASE}/paper/close/${encodeURIComponent(tradeId)}`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            showToast('Position closed', 'success');
            await loadTradingDashboard(true);
        } else {
            const errMsg = data.error || 'Close position failed';
            console.error('Close position failed:', errMsg);
            const status = document.getElementById('trading-status');
            if (status) {
                status.textContent = `✗ Close failed: ${errMsg}`;
                status.style.color = 'var(--red)';
                setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 5000);
            }
        }
    } catch (e) { console.error('Close position error:', e); }
}

async function toggleAutoTrade() {
    const toggle = document.getElementById('auto-trade-toggle');
    const enabled = toggle.checked;
    try {
        await fetch(`${API_BASE}/paper/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_trade_enabled: enabled }),
        });
    } catch (e) {
        console.error('Toggle auto-trade error:', e);
        toggle.checked = !enabled; // Revert
    }
}

async function toggleMultiLeg() {
    const toggle = document.getElementById('multi-leg-toggle');
    const enabled = toggle.checked;
    try {
        await fetch(`${API_BASE}/paper/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ multi_leg_enabled: enabled }),
        });
    } catch (e) {
        console.error('Toggle multi-leg error:', e);
        toggle.checked = !enabled; // Revert
    }
}

async function toggleRiskMode() {
    const toggle = document.getElementById('risk-mode-toggle');
    const label = document.getElementById('risk-mode-label');
    const mode = toggle.checked ? 'all' : 'limited';
    if (label) label.textContent = toggle.checked ? 'All Risk' : 'Limited Risk';
    try {
        await fetch(`${API_BASE}/paper/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ risk_mode: mode }),
        });
    } catch (e) {
        console.error('Toggle risk mode error:', e);
        toggle.checked = !toggle.checked;
        if (label) label.textContent = toggle.checked ? 'All Risk' : 'Limited Risk';
    }
}

async function resetPaperAccount() {
    if (!confirm('Reset paper account? This will clear ALL trades, signals, and equity history. Starting capital will be reset to $50,000.')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    try {
        const res = await fetch(`${API_BASE}/paper/reset`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            await loadTradingDashboard(true);
        }
    } catch (e) { console.error('Reset error:', e); }
}

// --- Portfolio Intelligence Strip ---
let _intelStripCache = { regime: null, vrp: null, ts: 0 };

async function updatePortfolioIntelStrip(portfolioDelta, portfolioTheta, portfolioGamma, positionTickers) {
    const el = (id) => document.getElementById(id);

    // Daily Theta (per-contract * 100 multiplier already done in caller display, but raw is per-share)
    const thetaVal = portfolioTheta !== 0 ? `$${(portfolioTheta * 100).toFixed(0)}` : '--';
    const thetaEl = el('intel-daily-theta');
    if (thetaEl) {
        thetaEl.textContent = thetaVal;
        thetaEl.style.color = portfolioTheta > 0 ? 'var(--green)' : portfolioTheta < 0 ? 'var(--red)' : '';
    }

    // Net Delta
    const deltaEl = el('intel-net-delta');
    if (deltaEl) {
        deltaEl.textContent = portfolioDelta !== 0 ? portfolioDelta.toFixed(2) : '--';
        deltaEl.style.color = portfolioDelta > 0 ? 'var(--green)' : portfolioDelta < 0 ? 'var(--red)' : '';
    }

    // Net Gamma
    const gammaEl = el('intel-net-gamma');
    if (gammaEl) {
        gammaEl.textContent = portfolioGamma !== 0 ? portfolioGamma.toFixed(3) : '--';
        gammaEl.style.color = portfolioGamma > 0 ? 'var(--green)' : portfolioGamma < 0 ? 'var(--red)' : '';
    }

    // Correlation (simple: # unique tickers as diversification proxy)
    const corrEl = el('intel-correlation');
    if (corrEl) {
        const n = positionTickers.size;
        if (n <= 1) {
            corrEl.textContent = n === 0 ? '--' : 'HIGH';
            corrEl.style.color = n === 0 ? '' : 'var(--red)';
        } else if (n <= 3) {
            corrEl.textContent = 'MED';
            corrEl.style.color = 'var(--orange)';
        } else {
            corrEl.textContent = 'LOW';
            corrEl.style.color = 'var(--green)';
        }
    }

    // Fetch regime + VRP from combined-regime endpoint (throttle to 60s)
    const now = Date.now();
    if (now - _intelStripCache.ts > 60000) {
        try {
            const regimeData = await safeFetchJson(`${API_BASE}/options/combined-regime/SPY`);
            if (regimeData && regimeData.ok && regimeData.data) {
                const d = regimeData.data;
                _intelStripCache.regime = d.combined_regime || d.gex_regime || null;
                _intelStripCache.vrp = d.vrp != null ? d.vrp : (d.iv_rank != null ? d.iv_rank : null);
                _intelStripCache.riskLevel = d.risk_level || null;
                _intelStripCache.ts = now;
            }
        } catch (e) { console.error('Intel strip regime fetch:', e); }
    }

    // VRP fallback: use spy_iv_rank from market sentiment (runs every cycle, not just on fetch)
    if (_intelStripCache.vrp == null && _lastSentimentData && _lastSentimentData.spy_iv_rank != null) {
        _intelStripCache.vrp = _lastSentimentData.spy_iv_rank;
    }

    // Regime
    const regimeEl = el('intel-regime');
    if (regimeEl) {
        if (_intelStripCache.regime) {
            const r = _intelStripCache.regime.toUpperCase().replace('_', ' ');
            regimeEl.textContent = r;
            const regimeColors = {
                'OPPORTUNITY': 'var(--green)', 'LOW VOL': 'var(--green)',
                'NORMAL': 'var(--blue)', 'BALANCED': 'var(--blue)',
                'CAUTION': 'var(--orange)', 'HIGH VOL': 'var(--orange)', 'TRANSITION': 'var(--orange)',
                'DANGER': 'var(--red)', 'CRISIS': 'var(--red)',
            };
            regimeEl.style.color = regimeColors[r] || 'var(--text)';
        } else if (_intelStripCache.ts > 0) {
            regimeEl.textContent = 'Closed';
            regimeEl.style.color = 'var(--text-dim)';
        }
    }

    // VRP
    const vrpEl = el('intel-vrp');
    if (vrpEl) {
        if (_intelStripCache.vrp != null) {
            const v = _intelStripCache.vrp;
            vrpEl.textContent = typeof v === 'number' ? v.toFixed(1) + '%' : v;
            vrpEl.style.color = v > 50 ? 'var(--green)' : v > 25 ? 'var(--orange)' : 'var(--red)';
        }
    }

    // Risk
    const riskEl = el('intel-risk');
    if (riskEl) {
        if (_intelStripCache.riskLevel) {
            const rl = _intelStripCache.riskLevel.toUpperCase();
            riskEl.textContent = rl;
            riskEl.style.color = rl === 'LOW' ? 'var(--green)' : rl === 'MEDIUM' ? 'var(--orange)' : 'var(--red)';
        } else if (_intelStripCache.ts > 0) {
            riskEl.textContent = 'Closed';
            riskEl.style.color = 'var(--text-dim)';
        }
    }

    // Timestamp
    const tsEl = el('intel-strip-ts');
    if (tsEl) {
        tsEl.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
}

// --- Auto Refresh ---
function startTradingRefresh() {
    stopTradingRefresh();
    tradingRefreshInterval = setInterval(async () => {
        if (document.getElementById('tab-trading')?.classList.contains('active')) {
            await Promise.all([
                loadPaperAccount(),
                loadPaperPositions(),
                loadPaperSignals(),
                loadPaperJournal(),
            ]);
        }
    }, 30000); // 30s
}

function stopTradingRefresh() {
    if (tradingRefreshInterval) {
        clearInterval(tradingRefreshInterval);
        tradingRefreshInterval = null;
    }
}

// =============================================================================
// 0DTE SPX ENGINE
// =============================================================================

let _0dteRefreshInterval = null;

async function load0DTEDashboard() {
    await Promise.all([
        load0DTEStatus(),
        load0DTEConfig(),
    ]);
}

async function load0DTEStatus() {
    const data = await safeFetchJson(`${API_BASE}/paper/0dte/status`);
    if (!data?.ok) return;
    const d = data.data;

    // Update status badge
    const badge = document.getElementById('zero-dte-status-badge');
    if (badge) {
        if (d.enabled) {
            badge.textContent = 'ACTIVE';
            badge.style.background = 'rgba(34,197,94,0.15)';
            badge.style.color = 'var(--green)';
        } else {
            badge.textContent = 'DISABLED';
            badge.style.background = 'rgba(239,68,68,0.15)';
            badge.style.color = 'var(--red)';
        }
    }

    // Toggle checkbox
    const toggle = document.getElementById('toggle-0dte');
    if (toggle) toggle.checked = d.enabled;

    // Circuit breaker
    const cb = document.getElementById('zero-dte-circuit-breaker');
    if (cb) cb.style.display = d.circuit_breaker_active ? 'block' : 'none';

    // GEX levels
    render0DTEGexLevels(d.gex_levels || {});

    // Market conditions
    render0DTEMarketConditions(d.market_conditions || {});

    // Opening range
    render0DTEOpeningRange(d.opening_range || {});

    // Condition gates
    render0DTEConditionGates(d.conditions_evaluated || {});

    // Kelly sizing
    render0DTEKellySizing(d.kelly_sizing || {});

    // Daily summary
    render0DTEPnLSummary(d.daily_summary || {});

    // Positions
    render0DTEPositions(d.positions || []);

    // Start/stop auto-refresh
    if (d.enabled && !_0dteRefreshInterval) {
        _0dteRefreshInterval = setInterval(() => load0DTEStatus(), 60000);
    } else if (!d.enabled && _0dteRefreshInterval) {
        clearInterval(_0dteRefreshInterval);
        _0dteRefreshInterval = null;
    }
}

async function load0DTEConfig() {
    const data = await safeFetchJson(`${API_BASE}/paper/0dte/config`);
    if (!data?.ok) return;
    const cfg = data.data;

    // Toggle checkbox
    const toggle = document.getElementById('toggle-0dte');
    if (toggle) toggle.checked = cfg.enabled;

    // Strategy pills
    const strategies = cfg.strategies || {};
    for (const [name, enabled] of Object.entries(strategies)) {
        const pill = document.getElementById(`pill-${name}`);
        if (pill) {
            pill.classList.toggle('active', enabled);
        }
    }
}

async function toggle0DTE() {
    const toggle = document.getElementById('toggle-0dte');
    const enabled = toggle?.checked ?? false;
    await safeFetchJson(`${API_BASE}/paper/0dte/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled}),
    });
    await load0DTEStatus();
}

async function toggle0DTEStrategy(name) {
    const pill = document.getElementById(`pill-${name}`);
    if (!pill) return;
    const nowActive = pill.classList.contains('active');
    const newState = !nowActive;
    pill.classList.toggle('active', newState);
    await safeFetchJson(`${API_BASE}/paper/0dte/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({strategies: {[name]: newState}}),
    });
}

async function trigger0DTESignalCheck(evt) {
    const btn = evt?.target;
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    try {
        const data = await safeFetchJson(`${API_BASE}/paper/0dte/check-signals`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: '{}',
        });
        if (data?.ok) {
            const d = data.data;
            render0DTEGexLevels(d.gex_levels || {});
            render0DTEMarketConditions(d.market_conditions || {});
            render0DTEConditionGates(d.conditions_evaluated || {});
            const sigCount = (d.signals || []).length;
            const execCount = (d.executed || []).length;
            if (btn) btn.textContent = `${sigCount} sig / ${execCount} exec`;
        } else {
            if (btn) btn.textContent = data?.error || 'Error';
        }
    } catch (e) {
        if (btn) btn.textContent = 'Error';
    }
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Check Now'; } }, 3000);
}

function render0DTEGexLevels(gex) {
    const fmt = (v) => v ? v.toLocaleString(undefined, {maximumFractionDigits: 0}) : '--';
    const el = (id) => document.getElementById(id);

    const spxEl = el('zero-dte-spx');
    if (spxEl) spxEl.textContent = fmt(gex.spx_price);
    const cwEl = el('zero-dte-call-wall');
    if (cwEl) cwEl.textContent = fmt(gex.call_wall);
    const pwEl = el('zero-dte-put-wall');
    if (pwEl) pwEl.textContent = fmt(gex.put_wall);
    const gfEl = el('zero-dte-gamma-flip');
    if (gfEl) gfEl.textContent = fmt(gex.gamma_flip);
    const mpEl = el('zero-dte-max-pain');
    if (mpEl) mpEl.textContent = fmt(gex.max_pain);

    const signEl = el('zero-dte-gex-sign');
    if (signEl) {
        const sign = gex.gex_sign || '--';
        signEl.textContent = sign.toUpperCase();
        signEl.style.color = sign === 'positive' ? 'var(--green)' : sign === 'negative' ? 'var(--red)' : '';
    }

    const pinEl = el('zero-dte-pin-score');
    if (pinEl) {
        const score = gex.pin_score || 0;
        pinEl.textContent = score;
        pinEl.style.color = score >= 65 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--text-muted)';
    }

    // VIX
    const vixEl = el('zero-dte-vix');
    if (vixEl && gex.vix) {
        vixEl.textContent = gex.vix.toFixed(1);
        vixEl.style.color = gex.vix > 35 ? 'var(--red)' : gex.vix > 25 ? 'var(--yellow)' : 'var(--text-muted)';
    }

    // VIX1D
    const vix1dEl = el('zero-dte-vix1d');
    if (vix1dEl && gex.vix1d) {
        vix1dEl.textContent = gex.vix1d.toFixed(1);
    }

    // Charm bias
    const charmEl = el('zero-dte-charm');
    if (charmEl) {
        const charm = gex.charm_bias || 0;
        if (charm > 0) {
            charmEl.textContent = 'BULL';
            charmEl.style.color = 'var(--green)';
        } else if (charm < 0) {
            charmEl.textContent = 'BEAR';
            charmEl.style.color = 'var(--red)';
        } else {
            charmEl.textContent = 'FLAT';
            charmEl.style.color = 'var(--text-muted)';
        }
    }

    const tsEl = el('zero-dte-gex-ts');
    if (tsEl) tsEl.textContent = new Date().toLocaleTimeString();
}

function render0DTEPnLSummary(summary) {
    const el = (id) => document.getElementById(id);

    const trades = el('zero-dte-trades-today');
    if (trades) trades.textContent = summary.trades_today ?? 0;

    const pnl = el('zero-dte-pnl');
    if (pnl) {
        const val = summary.pnl ?? 0;
        pnl.textContent = `$${val.toFixed(0)}`;
        pnl.style.color = val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : '';
    }

    const wr = el('zero-dte-win-rate');
    if (wr) wr.textContent = `${(summary.win_rate ?? 0).toFixed(0)}%`;

    const open = el('zero-dte-open-pos');
    if (open) open.textContent = summary.open_positions ?? 0;

    const weeklyEl = el('zero-dte-weekly-pnl');
    if (weeklyEl) {
        const val = summary.weekly_pnl ?? 0;
        weeklyEl.textContent = `$${val.toFixed(0)}`;
        weeklyEl.style.color = val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : '';
    }

    const monthlyEl = el('zero-dte-monthly-pnl');
    if (monthlyEl) {
        const val = summary.monthly_pnl ?? 0;
        monthlyEl.textContent = `$${val.toFixed(0)}`;
        monthlyEl.style.color = val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : '';
    }
}

function render0DTEMarketConditions(mc) {
    const container = document.getElementById('zero-dte-market-conditions');
    if (!container || !mc.day_of_week) { if (container) container.innerHTML = ''; return; }

    const pill = (label, value, color) =>
        `<span style="font-size: 0.6rem; padding: 2px 8px; border-radius: 10px; background: ${color}15; color: ${color}; border: 1px solid ${color}30; white-space: nowrap;" title="${label}: ${value}">${label}: ${value}</span>`;

    const vixColor = mc.vix_regime === 'extreme' ? 'var(--red)' : mc.vix_regime === 'elevated' ? 'var(--yellow)' : 'var(--green)';
    const gexColor = mc.gex_sign === 'positive' ? 'var(--green)' : 'var(--red)';
    const dayColor = ['Wed', 'Fri'].includes(mc.day_of_week) ? 'var(--red)' : 'var(--green)';
    const macroColor = mc.macro_event !== 'none' ? 'var(--yellow)' : 'var(--text-muted)';
    const maColor = mc.spx_above_20sma ? 'var(--green)' : 'var(--red)';

    let html = '';
    html += pill('DAY', mc.day_of_week, dayColor);
    html += pill('VIX', `${mc.vix_regime} (${mc.vix?.toFixed(1)})`, vixColor);
    html += pill('GEX', mc.gex_sign, gexColor);
    html += pill('TIME', mc.time_period, 'var(--text-muted)');
    if (mc.macro_event !== 'none') html += pill('MACRO', mc.macro_event, macroColor);
    html += pill('MA', mc.spx_above_20sma ? 'Above 20-SMA' : 'Below 20-SMA', maColor);
    if (mc.ema5_above_ema40 !== undefined) {
        html += pill('TREND', mc.ema5_above_ema40 ? '5EMA > 40EMA' : '5EMA < 40EMA',
            mc.ema5_above_ema40 ? 'var(--green)' : 'var(--red)');
    }
    html += pill('WALLS', mc.wall_strength || 'stable', mc.wall_strength === 'strengthening' ? 'var(--green)' : mc.wall_strength === 'weakening' ? 'var(--red)' : 'var(--text-muted)');
    if (mc.volume_bias && mc.volume_bias !== 'balanced') {
        html += pill('VOL', mc.volume_bias, mc.volume_bias === 'call_heavy' ? 'var(--green)' : 'var(--red)');
    }
    container.innerHTML = html;
}

function render0DTEOpeningRange(or_data) {
    const container = document.getElementById('zero-dte-opening-range');
    if (!container) return;
    if (!or_data.complete || !or_data.high) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    const range = or_data.range_size || (or_data.high - or_data.low);
    const dirColor = or_data.breakout_direction === 'up' ? 'var(--green)' : or_data.breakout_direction === 'down' ? 'var(--red)' : 'var(--text-muted)';
    const breakoutLabel = or_data.breakout_direction ? `BREAKOUT ${or_data.breakout_direction.toUpperCase()}` : 'IN RANGE';

    container.innerHTML = `
        <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 4px;">Opening Range (9:30-10:30)</div>
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem;">
            <span style="color: var(--red);">${or_data.low?.toFixed(0)}</span>
            <div style="flex: 1; height: 4px; background: var(--border); border-radius: 2px; position: relative;">
                <div style="position: absolute; left: 0; top: 0; height: 100%; width: 100%; background: linear-gradient(90deg, var(--red), var(--text-muted), var(--green)); border-radius: 2px; opacity: 0.3;"></div>
            </div>
            <span style="color: var(--green);">${or_data.high?.toFixed(0)}</span>
            <span style="font-size: 0.6rem; color: var(--text-muted);">${range?.toFixed(0)}pts</span>
            <span style="font-size: 0.6rem; font-weight: 600; color: ${dirColor};">${breakoutLabel}</span>
        </div>`;
}

function render0DTEConditionGates(conditions) {
    const container = document.getElementById('zero-dte-condition-gates');
    if (!container) return;
    if (!conditions || !Object.keys(conditions).length) {
        container.innerHTML = '';
        return;
    }
    const stratNames = {
        iron_condor_walls: 'IC Walls', credit_spread_fade: 'CS Fade',
        pin_butterfly: 'Pin Fly', directional_momentum: 'Momentum',
        gamma_scalp_straddle: 'Gamma Scalp', opening_range_breakout: 'ORB',
    };
    let html = '<div style="font-size: 0.6rem; display: flex; flex-wrap: wrap; gap: 4px;">';
    for (const [key, val] of Object.entries(conditions)) {
        const name = stratNames[key] || key;
        let bg, color, label;
        if (val.status === 'signal_generated') {
            bg = 'rgba(34,197,94,0.12)'; color = 'var(--green)';
            label = `${name}: ${val.confidence} (+${val.boost || 0})`;
        } else if (val.status === 'no_signal') {
            bg = 'rgba(100,100,100,0.08)'; color = 'var(--text-muted)';
            label = `${name}: active`;
        } else {
            bg = 'rgba(239,68,68,0.1)'; color = 'var(--red)';
            const reason = val.reasons?.[0] || val.status?.replace(/_/g, ' ') || 'disabled';
            label = `${name}: ${reason}`;
        }
        html += `<span style="padding: 1px 6px; border-radius: 6px; background: ${bg}; color: ${color}; border: 1px solid ${color}20;">${label}</span>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function render0DTEKellySizing(kelly) {
    const container = document.getElementById('zero-dte-kelly-sizing');
    if (!container) return;
    if (!kelly || !Object.keys(kelly).length) { container.innerHTML = ''; return; }

    const stratNames = {
        iron_condor_walls: 'IC Walls', credit_spread_fade: 'CS Fade',
        pin_butterfly: 'Pin Fly', directional_momentum: 'Momentum',
        gamma_scalp_straddle: 'Gamma Scalp', opening_range_breakout: 'ORB',
    };

    let html = '<details style="font-size: 0.65rem;"><summary style="cursor: pointer; color: var(--text-muted); margin-bottom: 4px;">Kelly Sizing</summary>';
    html += '<table style="width: 100%; font-size: 0.6rem; border-collapse: collapse;">';
    html += '<thead><tr style="color: var(--text-muted);"><th style="text-align:left;padding:2px 4px;">Strategy</th><th>Kelly%</th><th>Contracts</th><th>EV</th></tr></thead><tbody>';
    for (const [key, val] of Object.entries(kelly)) {
        const name = stratNames[key] || key;
        const evColor = val.ev > 0 ? 'var(--green)' : val.ev < 0 ? 'var(--red)' : '';
        html += `<tr>`;
        html += `<td style="padding:2px 4px;">${name}</td>`;
        html += `<td style="text-align:center;">${(val.kelly_adjusted * 100).toFixed(1)}%</td>`;
        html += `<td style="text-align:center;">${val.contracts}</td>`;
        html += `<td style="text-align:center;color:${evColor}">${val.ev !== null ? `$${val.ev}` : '--'}</td>`;
        html += `</tr>`;
    }
    html += '</tbody></table></details>';
    container.innerHTML = html;
}

function render0DTEPositions(positions) {
    const container = document.getElementById('zero-dte-positions');
    if (!container) return;

    if (!positions.length) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px; font-size: 0.75rem;">No 0DTE positions</div>';
        return;
    }

    let html = '<table class="trading-table" style="width: 100%; font-size: 0.7rem;">';
    html += '<thead><tr><th>Strategy</th><th>Legs</th><th>Entry</th><th>P&L%</th><th>Time</th></tr></thead>';
    html += '<tbody>';
    for (const p of positions) {
        const pnlColor = (p.pnl_pct || 0) > 0 ? 'var(--green)' : (p.pnl_pct || 0) < 0 ? 'var(--red)' : '';
        html += `<tr>`;
        html += `<td>${p.strategy || '--'}</td>`;
        html += `<td style="font-family: monospace; font-size: 0.65rem;">${p.legs || '--'}</td>`;
        html += `<td>$${(p.entry_premium || 0).toFixed(2)}</td>`;
        html += `<td style="color: ${pnlColor}">${(p.pnl_pct || 0).toFixed(1)}%</td>`;
        html += `<td>${p.minutes_open || 0}m</td>`;
        html += `</tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}


console.log('Gamma Quantix initialized. API:', API_BASE);
