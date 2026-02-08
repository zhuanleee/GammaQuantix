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
    vpPosition: 'In Range'
};

// Technical indicator state
let volumeSeries = null;
let indicatorSeries = {};    // {sma20, sma50, sma200, vwap, bbMiddle, bbUpper, bbLower}
let rsiChart = null;
let rsiSeries = null;
let rsChart = null;
let rsSeries = null;
let rsSmaSeries = null;
let selectedInterval = localStorage.getItem('gq_interval') || '1d';
const INTERVAL_DAYS_MAP = {
    '1m': 1, '5m': 5, '15m': 10, '30m': 15,
    '1h': 30, '4h': 60, '1d': null, '1w': null
};

// Toggle persistence
const TOGGLE_IDS = [
    'viz-toggle-callwall','viz-toggle-putwall','viz-toggle-gammaflip','viz-toggle-maxpain',
    'viz-toggle-val','viz-toggle-poc','viz-toggle-vah','viz-toggle-gex',
    'viz-toggle-sma20','viz-toggle-sma50','viz-toggle-sma200','viz-toggle-vwap','viz-toggle-bb',
    'viz-toggle-rsi','viz-toggle-rs','viz-toggle-volume'
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
        const ivRank = sentiment.iv_rank || 0;
        document.getElementById('oa-iv-rank').textContent = `${ivRank.toFixed(0)}%`;
        let ivLabel = 'Normal', ivColor = 'var(--text)';
        if (ivRank > 50) { ivLabel = 'High (Sell)'; ivColor = 'var(--orange)'; }
        else if (ivRank < 20) { ivLabel = 'Low (Buy)'; ivColor = 'var(--green)'; }
        document.getElementById('oa-iv-label').textContent = ivLabel;
        document.getElementById('oa-iv-label').style.color = ivColor;

        // Max Pain
        const maxPainPrice = mp.max_pain_price || mp.max_pain || 0;
        const maxPainEl = document.getElementById('oa-max-pain');
        if (maxPainEl) {
            maxPainEl.textContent = maxPainPrice > 0 ? `$${maxPainPrice.toFixed(0)}` : '--';
        }
        const mpDistEl = document.getElementById('oa-mp-distance');

        // Current Price
        const currentPrice = gex.current_price || flow.current_price || sentiment.current_price || 0;
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

        // Load Options Chain
        loadOptionsChain();

        // Load GEX Dashboard
        loadGexDashboard();

        // Render Expected Move card
        const atmIV = sentiment.current_iv || sentiment.atm_iv || sentiment.iv_30 || (sentiment.skew && sentiment.skew.call_iv) || 0;
        if (currentPrice > 0 && atmIV > 0) {
            renderExpectedMove(currentPrice, atmIV, Math.max(dte, 1));
        }

    } catch (e) {
        console.error('Options analysis error:', e);
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
            if (btn) btn.textContent = `Scanning 0/${scanExps.length}...`;
            const today = new Date(); today.setHours(0, 0, 0, 0);

            const promises = scanExps.map(async (expObj) => {
                const url = buildUrl(expObj.date);
                try {
                    const resp = await fetch(url);
                    const json = await resp.json();
                    scannedCount++;
                    if (btn) btn.textContent = `Scanning ${scannedCount}/${scanExps.length}...`;
                    if (json.ok && json.data) return { data: json.data, dte: expObj.dte, exp: expObj.date };
                } catch (e) { scannedCount++; if (btn) btn.textContent = `Scanning ${scannedCount}/${scanExps.length}...`; }
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

        // Parse volume profile (skip for futures - no relevant VP data)
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
            optionsVizData.val = 0;
            optionsVizData.poc = 0;
            optionsVizData.vah = 0;
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

    if (!optionsVizData.candles || optionsVizData.candles.length === 0) {
        // Create a synthetic candle from current price so chart can render and live updates work
        if (optionsVizData.currentPrice > 0) {
            const today = new Date();
            const isDaily = selectedInterval === '1d' || selectedInterval === '1w';
            const p = optionsVizData.currentPrice;
            const t = isDaily
                ? today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
                : Math.floor(today.getTime() / 1000);
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

    priceChart = LightweightCharts.createChart(container, {
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.05)' },
            horzLines: { color: 'rgba(255,255,255,0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 } },
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

    priceChart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(entries => {
        if (priceChart && container.clientWidth > 0) {
            priceChart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight || 300
            });
        }
    });
    resizeObserver.observe(container);

    startLivePriceUpdates();
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
        textEl.textContent = 'Live';
        textEl.style.color = '#10b981';
    } else {
        dotEl.style.background = '#f59e0b';
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
            const lastTime = lastCandle ? lastCandle.time : null;
            const isToday = lastTime && (typeof lastTime === 'string'
                ? lastTime === y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
                : lastTime.year === y && lastTime.month === m && lastTime.day === d);

            if (lastCandle && isToday) {
                // Today's candle exists — update OHLC
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
            } else {
                // No candle for today — only create one on weekdays (trading days)
                const dayOfWeek = today.getDay();
                const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
                if (isWeekday) {
                    const useObjFormat = optionsVizData.candles.length > 0 && typeof optionsVizData.candles[0].time === 'object';
                    const newTime = useObjFormat ? { year: y, month: m, day: d } : y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                    const newCandle = {
                        time: newTime,
                        open: price,
                        high: price,
                        low: price,
                        close: price,
                        volume: 0
                    };
                    priceSeries.update(newCandle);
                    optionsVizData.candles.push(newCandle);
                }
                // Weekend/holiday: don't create a fake candle, just update price displays
            }
        }
    }

    optionsVizData.currentPrice = price;
    optionsChartData.currentPrice = price;

    // Update ALL price displays across the page
    const priceEl = document.getElementById('viz-current-price');
    if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;

    // Analysis tab current price
    const oaPriceEl = document.getElementById('oa-current-price');
    if (oaPriceEl) oaPriceEl.textContent = `$${price.toFixed(2)}`;

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
    }
    if (rsiChart) {
        var rc = document.getElementById('rsi-chart-container');
        if (rc && rc.clientWidth > 0) rsiChart.applyOptions({ width: rc.clientWidth, height: rc.clientHeight || 100 });
    }
    if (rsChart) {
        var rsc = document.getElementById('rs-chart-container');
        if (rsc && rsc.clientWidth > 0) rsChart.applyOptions({ width: rsc.clientWidth, height: rsc.clientHeight || 100 });
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
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
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
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
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
async function loadMarketSentiment() {
    try {
        const [sentimentRes, expirationsRes] = await Promise.all([
            fetch(`${API_BASE}/options/market-sentiment`),
            fetch(`${API_BASE}/options/expirations/SPY`)
        ]);

        const data = await sentimentRes.json();
        const expData = await expirationsRes.json();

        if (data.ok && data.data) {
            const sentiment = data.data;
            const vix = sentiment.vix || 0;
            const vixEl = document.getElementById('vix-level');
            vixEl.textContent = vix.toFixed(1);
            vixEl.style.color = vix > 25 ? 'var(--red)' : vix < 15 ? 'var(--green)' : 'var(--text)';
            document.getElementById('vix-label').textContent = vix > 25 ? 'High Fear' : vix < 15 ? 'Low Fear' : 'Normal';
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
    document.getElementById('spy-max-pain').textContent = '...';
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
        pcEl.textContent = pcRatio.toFixed(2);
        pcEl.style.color = pcRatio > 1.0 ? 'var(--red)' : pcRatio < 0.7 ? 'var(--green)' : 'var(--text)';
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
        document.getElementById('gex-label').textContent = gexValue > 0 ? 'Stabilizing' : 'Volatile';

        // Max Pain
        const maxPainEl = document.getElementById('spy-max-pain');
        const distEl = document.getElementById('spy-max-pain-dist');
        const maxPain = mp.max_pain_price || 0;
        maxPainEl.textContent = maxPain > 0 ? '$' + maxPain.toFixed(0) : '--';

        const dist = mp.distance_pct || 0;
        const direction = mp.direction || '';
        const arrow = direction === 'above' ? '\u2193' : direction === 'below' ? '\u2191' : '';
        distEl.textContent = (dist > 0 ? '+' : '') + dist.toFixed(1) + '% ' + arrow;
        distEl.style.color = Math.abs(dist) < 2 ? 'var(--green)' : Math.abs(dist) < 5 ? 'var(--yellow)' : 'var(--text-muted)';

        const vixText = document.getElementById('vix-level').textContent;
        const vix = parseFloat(vixText) || 0;
        updateSentimentGauge(pcRatio, vix);

    } catch (e) {
        console.error('Failed to load sentiment for expiry:', e);
        document.getElementById('spy-max-pain').textContent = '--';
        document.getElementById('spy-max-pain-dist').textContent = 'N/A';
    }
}

// =============================================================================
// SENTIMENT GAUGE
// =============================================================================
function updateSentimentGauge(pcRatio, vix) {
    let score = 50;

    if (pcRatio < 0.6) score += 30;
    else if (pcRatio < 0.8) score += 15;
    else if (pcRatio > 1.2) score -= 30;
    else if (pcRatio > 1.0) score -= 15;

    if (vix < 15) score += 10;
    else if (vix > 30) score -= 15;
    else if (vix > 25) score -= 10;

    score = Math.max(0, Math.min(100, score));

    const angle = -90 + (score / 100) * 180;

    const needle = document.getElementById('sentiment-needle');
    if (needle) {
        needle.setAttribute('transform', 'rotate(' + angle + ', 100, 95)');
    }

    // Update glow color based on sentiment
    var glow = document.getElementById('sentiment-glow');
    if (glow) {
        var glowColor;
        if (score >= 65) glowColor = 'rgba(34,197,94,0.12)';
        else if (score >= 40) glowColor = 'rgba(234,179,8,0.12)';
        else glowColor = 'rgba(239,68,68,0.12)';
        glow.style.background = 'radial-gradient(ellipse, ' + glowColor + ' 0%, transparent 70%)';
    }

    const label = document.getElementById('sentiment-label');
    const description = document.getElementById('sentiment-description');

    // Build dynamic description based on actual inputs
    const pcDesc = pcRatio > 1.2 ? 'High P/C' : pcRatio < 0.7 ? 'Low P/C' : 'Neutral P/C';
    const vixDesc = vix > 25 ? 'High VIX' : vix < 15 ? 'Low VIX' : 'Normal VIX';

    if (score >= 75) {
        label.textContent = 'BULLISH';
        label.style.color = 'var(--green)';
        description.textContent = pcDesc + ' + ' + vixDesc + ' = Risk On';
    } else if (score >= 60) {
        label.textContent = 'LEAN BULLISH';
        label.style.color = 'var(--green)';
        description.textContent = pcDesc + ' + ' + vixDesc;
    } else if (score >= 40) {
        label.textContent = 'NEUTRAL';
        label.style.color = 'var(--text)';
        description.textContent = pcDesc + ' + ' + vixDesc + ' = Mixed signals';
    } else if (score >= 25) {
        label.textContent = 'LEAN BEARISH';
        label.style.color = 'var(--red)';
        description.textContent = pcDesc + ' + ' + vixDesc + ' = Elevated caution';
    } else {
        label.textContent = 'BEARISH';
        label.style.color = 'var(--red)';
        description.textContent = pcDesc + ' + ' + vixDesc + ' = Risk Off';
    }
}

// =============================================================================
// WHALE TRADES
// =============================================================================
async function loadWhaleTrades() {
    showTab('tab-chain-flow');
    const container = document.getElementById('whale-trades-container');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Loading whale trades...</div>';

    try {
        const res = await fetch(`${API_BASE}/options/whales?min_premium=50000`);
        const data = await res.json();

        if (data.ok && (data.whales || data.data) && (data.whales || data.data).length > 0) {
            const trades = data.whales || data.data;
            let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">';
            html += '<thead><tr style="background: var(--bg-hover); border-bottom: 1px solid var(--border);">';
            html += '<th style="padding: 8px; text-align: left;">Ticker</th>';
            html += '<th style="padding: 8px; text-align: left;">Type</th>';
            html += '<th style="padding: 8px; text-align: right;">Strike</th>';
            html += '<th style="padding: 8px; text-align: right;">Premium</th>';
            html += '<th style="padding: 8px; text-align: center;">Side</th>';
            html += '</tr></thead><tbody>';

            trades.slice(0, 15).forEach(t => {
                const sideColor = t.side?.toLowerCase() === 'buy' ? 'var(--green)' : 'var(--red)';
                const premium = (t.premium || 0) / 1000;

                html += `<tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 8px; font-weight: 600;">${t.ticker || '--'}</td>
                    <td style="padding: 8px;">${(t.type || 'C').toUpperCase()}</td>
                    <td style="padding: 8px; text-align: right;">$${(t.strike || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right; font-weight: 600;">$${premium.toLocaleString(undefined, {maximumFractionDigits: 0})}K</td>
                    <td style="padding: 8px; text-align: center; color: ${sideColor}; font-weight: 600;">${(t.side || 'BUY').toUpperCase()}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No whale trades found</div>';
        }
    } catch (e) {
        console.error('Failed to load whale trades:', e);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red);">Failed to load whale trades</div>';
    }
}

// =============================================================================
// UNUSUAL ACTIVITY
// =============================================================================
async function loadUnusualActivity() {
    showTab('tab-chain-flow');
    const container = document.getElementById('unusual-activity-container');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Scanning unusual activity...</div>';

    try {
        const tickers = 'NVDA,AAPL,TSLA,META,AMZN,GOOGL,MSFT,AMD,SPY,QQQ';
        const res = await fetch(`${API_BASE}/options/feed?tickers=${tickers}`);
        const data = await res.json();

        if (data.ok && (data.feed || data.data) && (data.feed || data.data).length > 0) {
            const items = data.feed || data.data;
            let html = '<div style="padding: 8px 0;">';

            items.slice(0, 12).forEach(item => {
                const volOi = item.vol_oi_ratio || item.volume_oi_ratio || 0;
                const premium = (item.premium || 0) / 1000;
                const unusualBadge = volOi > 3 ? '<span style="background: var(--yellow); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; margin-left: 8px;">HOT</span>' : '';

                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border);">
                    <div>
                        <span style="font-weight: 600;">${item.ticker || '--'}</span>
                        <span style="color: var(--text-muted); margin-left: 8px;">$${(item.strike || 0).toLocaleString()}</span>
                        ${unusualBadge}
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: 600;">$${premium.toLocaleString(undefined, {maximumFractionDigits: 0})}K</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">Vol/OI: ${volOi.toFixed(1)}x</div>
                    </div>
                </div>`;
            });

            html += '</div>';
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No unusual activity detected</div>';
        }
    } catch (e) {
        console.error('Failed to load unusual activity:', e);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red);">Failed to scan</div>';
    }
}

// =============================================================================
// TOGGLE ACCORDION
// =============================================================================
function toggleAccordion(element) {
    element.classList.toggle('open');
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
// LOAD OPTIONS CHAIN
// =============================================================================
async function loadOptionsChain() {
    const ticker = optionsAnalysisTicker;
    if (!ticker) return;

    try {
        document.getElementById('calls-table-body').innerHTML =
            '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">Loading...</td></tr>';
        document.getElementById('puts-table-body').innerHTML =
            '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">Loading...</td></tr>';

        const isFutures = ticker.startsWith('/');
        const url = isFutures
            ? `${API_BASE}/options/chain?ticker=${encodeURIComponent(ticker)}`
            : `${API_BASE}/options/chain/${ticker}`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.ok || (data.data && data.data.error)) {
            throw new Error(data.data?.error || 'Failed to load options chain');
        }

        const chain = data.data || {};

        // Show tables and summary
        document.getElementById('options-tables').style.display = 'grid';
        document.getElementById('options-summary').style.display = 'grid';

        // Populate summary stats from top-level chain fields
        const totalCallVol = chain.total_call_volume || 0;
        const totalPutVol = chain.total_put_volume || 0;
        const pcRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : 0;
        const sentiment = pcRatio > 1.2 ? 'bearish' : pcRatio < 0.8 ? 'bullish' : 'neutral';
        const sentimentColor = sentiment === 'bullish' ? 'var(--green)' :
                              sentiment === 'bearish' ? 'var(--red)' :
                              'var(--text-muted)';

        document.getElementById('opt-sentiment').textContent = sentiment.toUpperCase();
        document.getElementById('opt-sentiment').style.color = sentimentColor;
        document.getElementById('opt-pc-ratio').textContent = pcRatio.toFixed(2);
        document.getElementById('opt-call-vol').textContent = totalCallVol.toLocaleString();
        document.getElementById('opt-put-vol').textContent = totalPutVol.toLocaleString();

        // Filter chains to center around ATM (±20 strikes from current price)
        const currentPrice = chain.underlying_price || optionsChartData.currentPrice || 0;
        const filterNearATM = (contracts) => {
            if (!contracts.length || !currentPrice) return contracts.slice(0, 50);
            const sorted = [...contracts].sort((a, b) => a.strike - b.strike);
            const atmIdx = sorted.findIndex(c => c.strike >= currentPrice);
            const start = Math.max(0, atmIdx - 20);
            const end = Math.min(sorted.length, atmIdx + 21);
            return sorted.slice(start, end);
        };

        // Render calls table
        const calls = filterNearATM(chain.calls || []);
        if (calls.length === 0) {
            document.getElementById('calls-table-body').innerHTML =
                '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">No call contracts available</td></tr>';
        } else {
            document.getElementById('calls-table-body').innerHTML = calls.map(c => {
                const deltaColor = (c.delta || 0) >= 0.5 ? 'var(--green)' : 'var(--text-muted)';
                const bidVal = c.bid != null ? c.bid : c.last_price || 0;
                const askVal = c.ask != null ? c.ask : c.last_price || 0;
                const isATM = currentPrice && Math.abs(c.strike - currentPrice) < 2;
                const rowBg = isATM ? 'background: rgba(99, 102, 241, 0.1);' : '';
                return `<tr style="border-bottom: 1px solid var(--border); ${rowBg}">
                    <td style="padding: 8px; font-weight: 600;">$${c.strike || '--'}</td>
                    <td style="padding: 8px; text-align: right;">$${bidVal.toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">$${askVal.toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">${(c.volume || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${(c.open_interest || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${c.implied_volatility ? (c.implied_volatility * 100).toFixed(1) + '%' : '--'}</td>
                    <td style="padding: 8px; text-align: right; color: ${deltaColor}; font-weight: 600;">${c.delta ? c.delta.toFixed(3) : '--'}</td>
                </tr>`;
            }).join('');
        }

        // Render puts table
        const puts = filterNearATM(chain.puts || []);
        if (puts.length === 0) {
            document.getElementById('puts-table-body').innerHTML =
                '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">No put contracts available</td></tr>';
        } else {
            document.getElementById('puts-table-body').innerHTML = puts.map(p => {
                const deltaColor = Math.abs(p.delta || 0) >= 0.5 ? 'var(--red)' : 'var(--text-muted)';
                const bidVal = p.bid != null ? p.bid : p.last_price || 0;
                const askVal = p.ask != null ? p.ask : p.last_price || 0;
                const isATM = currentPrice && Math.abs(p.strike - currentPrice) < 2;
                const rowBg = isATM ? 'background: rgba(99, 102, 241, 0.1);' : '';
                return `<tr style="border-bottom: 1px solid var(--border); ${rowBg}">
                    <td style="padding: 8px; font-weight: 600;">$${p.strike || '--'}</td>
                    <td style="padding: 8px; text-align: right;">$${bidVal.toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">$${askVal.toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">${(p.volume || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${(p.open_interest || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${p.implied_volatility ? (p.implied_volatility * 100).toFixed(1) + '%' : '--'}</td>
                    <td style="padding: 8px; text-align: right; color: ${deltaColor}; font-weight: 600;">${p.delta ? p.delta.toFixed(3) : '--'}</td>
                </tr>`;
            }).join('');
        }

        console.log('Options chain loaded for', ticker);

        // Render IV Smile chart from chain data
        renderIVSmile(chain.calls || [], chain.puts || [], currentPrice);

    } catch (e) {
        console.error('Failed to load options chain:', e);
        document.getElementById('calls-table-body').innerHTML =
            '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--red);">Failed to load</td></tr>';
        document.getElementById('puts-table-body').innerHTML =
            '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--red);">Failed to load</td></tr>';
    }
}

// =============================================================================
// OPTIONS SCREENER
// =============================================================================
// =============================================================================
// SMART MONEY FLOW
// =============================================================================
async function loadSmartMoneyFlow() {
    // Use flow input, or fall back to options-ticker-input, or header ticker-input
    let ticker = document.getElementById('flow-ticker-input')?.value.trim().toUpperCase();
    if (!ticker) ticker = optionsAnalysisTicker;
    if (!ticker) ticker = document.getElementById('ticker-input')?.value.trim().toUpperCase();
    if (!ticker) {
        const container = document.getElementById('smart-money-flow-container');
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red);">Please enter a ticker symbol</div>';
        return;
    }

    // Auto-fill the flow input for clarity
    const flowInput = document.getElementById('flow-ticker-input');
    if (flowInput) flowInput.value = ticker;

    // Switch to Chain & Flow tab
    showTab('tab-chain-flow');

    const container = document.getElementById('smart-money-flow-container');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Analyzing flow...</div>';

    try {
        const isFutures = ticker.startsWith('/');
        const url = isFutures
            ? `${API_BASE}/options/smart-money?ticker=${encodeURIComponent(ticker)}`
            : `${API_BASE}/options/smart-money/${ticker}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.ok && data.data) {
            const flow = data.data;
            const netFlow = flow.net_flow || 0;
            const callFlow = flow.call_flow || 0;
            const putFlow = flow.put_flow || 0;
            const instRatio = flow.institutional_ratio || 0;

            const flowColor = netFlow > 0 ? 'var(--green)' : netFlow < 0 ? 'var(--red)' : 'var(--text-muted)';
            const flowLabel = netFlow > 0 ? 'NET INFLOW' : netFlow < 0 ? 'NET OUTFLOW' : 'NEUTRAL';

            let html = `
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div style="text-align: center; padding: 12px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 4px;">NET FLOW</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: ${flowColor};">$${Math.abs(netFlow / 1e6).toFixed(1)}M</div>
                        <div style="font-size: 0.65rem; color: ${flowColor};">${flowLabel}</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 4px;">CALL FLOW</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--green);">$${(callFlow / 1e6).toFixed(1)}M</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 4px;">PUT FLOW</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--red);">$${(putFlow / 1e6).toFixed(1)}M</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: var(--bg-hover); border-radius: 8px;">
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 4px;">INSTITUTIONAL</div>
                        <div style="font-size: 1.25rem; font-weight: 700;">${(instRatio * 100).toFixed(0)}%</div>
                    </div>
                </div>
            `;

            const notable = flow.notable_trades || [];
            if (notable.length > 0) {
                html += '<div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 8px;">Notable Trades</div>';
                html += '<div style="max-height: 200px; overflow-y: auto;">';
                notable.slice(0, 8).forEach(t => {
                    const premium = (t.premium || 0) / 1000;
                    let expiry = '';
                    if (t.expiration) {
                        const d = new Date(t.expiration + 'T00:00:00');
                        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        expiry = months[d.getMonth()] + ' ' + d.getDate();
                    }

                    html += `<div style="display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border);">
                        <span>$${(t.strike || 0).toLocaleString()} ${t.type || 'C'}${expiry ? ` <span style="color: var(--text-muted); font-size: 0.75rem;">(${expiry})</span>` : ''}</span>
                        <span style="font-weight: 600;">$${premium.toLocaleString(undefined, {maximumFractionDigits: 0})}K <span style="color: var(--text-muted); font-weight: normal; font-size: 0.75rem;">${t.signal || ''}</span></span>
                    </div>`;
                });
                html += '</div>';
            }

            container.innerHTML = html;
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No flow data for ' + ticker + '</div>';
        }
    } catch (e) {
        console.error('Failed to load smart money flow:', e);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red);">Failed to analyze flow</div>';
    }
}

// =============================================================================
// TAB SWITCHING
// =============================================================================
function showTab(tabId) {
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
        // Mark button as tracked
        const btn = document.querySelector(`.trade-idea-card[data-idx="${idx}"] .trade-idea-track-btn`);
        if (btn) { btn.textContent = 'Tracked'; btn.classList.add('tracked'); }
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
const SCANNER_TICKERS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];
window._multiTickerResults = null;
window._scannerFilterMode = 'overall';

// ── Feature 1: Weighted Scanner Score (0-100) ──────────────────────────────
function computeScannerScore(data) {
    // Base composite (40%)
    const baseScore = data.composite?.score ?? 0;
    const base = baseScore * 0.4;

    // Squeeze potential (15%)
    const squeezeRaw = data.squeeze_pin?.squeeze_score ?? 0;
    const squeeze = squeezeRaw * 0.15;

    // Flow conviction (15%) — ratio of dominant side notional
    let flowConviction = 0;
    if (data.smart_money) {
        const c = data.smart_money.total_call_notional || 0;
        const p = data.smart_money.total_put_notional || 0;
        const total = c + p;
        if (total > 0) {
            const ratio = Math.max(c, p) / total; // 0.5 – 1.0
            flowConviction = ((ratio - 0.5) / 0.5) * 100; // map to 0-100
        }
    }
    const flow = Math.min(flowConviction, 100) * 0.15;

    // Trade idea quality (15%) — HIGH×33 + MEDIUM×15, cap 100
    let ideaQuality = 0;
    const ideas = data.composite?.trade_ideas || [];
    ideas.forEach(idea => {
        const conf = (idea.confidence || '').toUpperCase();
        if (conf === 'HIGH') ideaQuality += 33;
        else if (conf === 'MEDIUM') ideaQuality += 15;
    });
    const ideaScore = Math.min(ideaQuality, 100) * 0.15;

    // Risk/reward position (15%) — (resistance-price)/(resistance-support) → 0-100
    let rrScore = 50; // default neutral
    const tz = data.trade_zones;
    if (tz) {
        const support = tz.support || 0;
        const resistance = tz.resistance || 0;
        const price = tz.current_price || 0;
        const range = resistance - support;
        if (range > 0 && price > 0) {
            rrScore = Math.max(0, Math.min(100, ((resistance - price) / range) * 100));
        }
    }
    const rr = rrScore * 0.15;

    return Math.round(Math.min(100, Math.max(0, base + squeeze + flow + ideaScore + rr)));
}

// ── Feature 3: Conviction Meter ────────────────────────────────────────────
function computeConviction(data) {
    const signals = [];

    // 1. Composite label
    const label = (data.composite?.label || '').toUpperCase();
    if (label.includes('BULLISH')) signals.push({ name: 'Composite', dir: 'bullish' });
    else if (label.includes('BEARISH')) signals.push({ name: 'Composite', dir: 'bearish' });
    else signals.push({ name: 'Composite', dir: 'neutral' });

    // 2. Smart flow
    const netFlow = (data.smart_money?.net_flow || '').toLowerCase();
    if (netFlow === 'bullish') signals.push({ name: 'Smart Flow', dir: 'bullish' });
    else if (netFlow === 'bearish') signals.push({ name: 'Smart Flow', dir: 'bearish' });
    else signals.push({ name: 'Smart Flow', dir: 'neutral' });

    // 3. Squeeze direction (if score >= 30)
    const sqScore = data.squeeze_pin?.squeeze_score ?? 0;
    const sqDir = (data.squeeze_pin?.direction || '').toUpperCase();
    if (sqScore >= 30) {
        if (sqDir === 'UP') signals.push({ name: 'Squeeze', dir: 'bullish' });
        else if (sqDir === 'DOWN') signals.push({ name: 'Squeeze', dir: 'bearish' });
        else signals.push({ name: 'Squeeze', dir: 'neutral' });
    } else {
        signals.push({ name: 'Squeeze', dir: 'neutral' });
    }

    // 4. MaxPain pull — price below max pain = bullish (price pulled up)
    const maxPain = data.trade_zones?.max_pain || data.composite?.max_pain || 0;
    const price = data.trade_zones?.current_price || 0;
    if (maxPain > 0 && price > 0) {
        if (price < maxPain) signals.push({ name: 'MaxPain', dir: 'bullish' });
        else if (price > maxPain) signals.push({ name: 'MaxPain', dir: 'bearish' });
        else signals.push({ name: 'MaxPain', dir: 'neutral' });
    } else {
        signals.push({ name: 'MaxPain', dir: 'neutral' });
    }

    // 5. Skew — normal/flat = bullish, steep = bearish
    const skewLabel = (data.vol_surface?.skew_label || '').toLowerCase();
    if (skewLabel === 'normal' || skewLabel === 'flat') signals.push({ name: 'Skew', dir: 'bullish' });
    else if (skewLabel === 'steep') signals.push({ name: 'Skew', dir: 'bearish' });
    else signals.push({ name: 'Skew', dir: 'neutral' });

    // 6. Term structure — normal = bullish, inverted = bearish
    const termSignal = (data.vol_surface?.term_signal || '').toLowerCase();
    if (termSignal === 'normal' || termSignal === 'contango') signals.push({ name: 'Term', dir: 'bullish' });
    else if (termSignal === 'inverted') signals.push({ name: 'Term', dir: 'bearish' });
    else signals.push({ name: 'Term', dir: 'neutral' });

    // 7. Trade idea — has HIGH confidence bullish/breakout idea?
    const ideas = data.composite?.trade_ideas || [];
    const hasBullHigh = ideas.some(i =>
        (i.confidence || '').toUpperCase() === 'HIGH' &&
        (i.type === 'bullish' || i.type === 'breakout')
    );
    const hasBearHigh = ideas.some(i =>
        (i.confidence || '').toUpperCase() === 'HIGH' && i.type === 'bearish'
    );
    if (hasBullHigh) signals.push({ name: 'Trade Idea', dir: 'bullish' });
    else if (hasBearHigh) signals.push({ name: 'Trade Idea', dir: 'bearish' });
    else signals.push({ name: 'Trade Idea', dir: 'neutral' });

    // 8. Fresh OI — more call vs put fresh positions
    const sm = data.smart_money;
    if (sm) {
        const callN = sm.total_call_notional || 0;
        const putN = sm.total_put_notional || 0;
        if (callN > putN * 1.1) signals.push({ name: 'Fresh OI', dir: 'bullish' });
        else if (putN > callN * 1.1) signals.push({ name: 'Fresh OI', dir: 'bearish' });
        else signals.push({ name: 'Fresh OI', dir: 'neutral' });
    } else {
        signals.push({ name: 'Fresh OI', dir: 'neutral' });
    }

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

// ── Feature 2: Filter Mode Scores ──────────────────────────────────────────
function computeBuyCallsScore(data) {
    // bullish flow(30) + bullish HIGH ideas(25) + squeeze UP(25) + cheap IV(20)
    let score = 0;
    const netFlow = (data.smart_money?.net_flow || '').toLowerCase();
    if (netFlow === 'bullish') score += 30;
    else if (netFlow !== 'bearish') score += 10;

    const ideas = data.composite?.trade_ideas || [];
    const bullHighCount = ideas.filter(i =>
        (i.confidence || '').toUpperCase() === 'HIGH' &&
        (i.type === 'bullish' || i.type === 'breakout')
    ).length;
    score += Math.min(bullHighCount * 25, 25);

    const sqDir = (data.squeeze_pin?.direction || '').toUpperCase();
    const sqScore = data.squeeze_pin?.squeeze_score ?? 0;
    if (sqDir === 'UP' && sqScore >= 30) score += 25;
    else if (sqDir === 'UP') score += 10;

    // cheap IV: lower IV rank = better for buying calls
    const ivRank = data.composite?.factors?.find(f => f.name && f.name.toLowerCase().includes('iv'));
    if (ivRank && ivRank.score < 40) score += 20;
    else if (ivRank && ivRank.score < 60) score += 10;

    return Math.min(100, score);
}

function computeSellPremiumScore(data) {
    // pin score(30) + rich theta count(25) + flat skew(20) + neutral label(25)
    let score = 0;
    const pinScore = data.squeeze_pin?.pin_score ?? 0;
    score += (pinScore / 100) * 30;

    // rich theta = high IV rank (good for selling)
    const ivFactor = data.composite?.factors?.find(f => f.name && f.name.toLowerCase().includes('iv'));
    if (ivFactor && ivFactor.score >= 60) score += 25;
    else if (ivFactor && ivFactor.score >= 40) score += 12;

    const skewLabel = (data.vol_surface?.skew_label || '').toLowerCase();
    if (skewLabel === 'flat') score += 20;
    else if (skewLabel === 'normal') score += 10;

    const label = (data.composite?.label || '').toUpperCase();
    if (label === 'NEUTRAL') score += 25;
    else if (!label.includes('STRONG')) score += 12;

    return Math.min(100, Math.round(score));
}

function computeMomentumScore(data) {
    // breakout ideas(35) + air pockets(30) + flow conviction(35)
    let score = 0;
    const ideas = data.composite?.trade_ideas || [];
    const breakoutCount = ideas.filter(i => i.type === 'breakout').length;
    score += Math.min(breakoutCount * 35, 35);

    // air pockets from dealer hedging
    const airPockets = data.dealer_hedging?.air_pockets?.length || 0;
    score += Math.min(airPockets * 15, 30);

    // flow conviction
    const sm = data.smart_money;
    if (sm) {
        const c = sm.total_call_notional || 0;
        const p = sm.total_put_notional || 0;
        const total = c + p;
        if (total > 0) {
            const ratio = Math.max(c, p) / total;
            score += ((ratio - 0.5) / 0.5) * 35;
        }
    }

    return Math.min(100, Math.round(Math.max(0, score)));
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
        const url = `${API_BASE}/options/xray/${ticker}`;
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
            case 'sellpremium':
                return computeSellPremiumScore(b.data) - computeSellPremiumScore(a.data);
            case 'squeeze':
                return (b.data.squeeze_pin?.squeeze_score ?? 0) - (a.data.squeeze_pin?.squeeze_score ?? 0);
            case 'momentum':
                return computeMomentumScore(b.data) - computeMomentumScore(a.data);
            default: { // 'overall'
                const sa = a.scannerScore ?? 0;
                const sb = b.scannerScore ?? 0;
                if (sb !== sa) return sb - sa;
                const confOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                const bestA = (a.data.composite?.trade_ideas || [])[0];
                const bestB = (b.data.composite?.trade_ideas || [])[0];
                return (confOrder[bestA?.confidence] ?? 3) - (confOrder[bestB?.confidence] ?? 3);
            }
        }
    });
}

function renderScannerResults(ranked) {
    const el = document.getElementById('scanner-results');
    if (!el) return;
    const mode = window._scannerFilterMode || 'overall';

    const rows = ranked.map((r, idx) => {
        const score = r.data.composite?.score ?? 0;
        const label = r.data.composite?.label || 'NEUTRAL';
        const scoreColor = score >= 75 ? 'var(--green)' : score >= 60 ? 'var(--blue)' : score >= 45 ? 'var(--orange)' : 'var(--red)';

        // Rank badge color
        const rankColors = ['#FFD700', 'var(--purple)', 'var(--blue)'];
        const rankColor = idx < 3 ? rankColors[idx] : 'var(--text-dim)';

        // Scanner score
        const ss = r.scannerScore ?? 0;
        const ssColor = ss >= 75 ? 'var(--green)' : ss >= 55 ? 'var(--blue)' : ss >= 40 ? 'var(--orange)' : 'var(--red)';

        // Conviction dots
        const conv = r.conviction || { total: 0, bullish: 0, bearish: 0, signals: [] };
        const dotsHtml = conv.signals.map(s =>
            `<span class="conviction-dot ${s.dir}" title="${s.name}: ${s.dir}"></span>`
        ).join('');
        const convCountHtml = `<span class="conviction-count">${conv.bullish}/${conv.total}</span>`;

        // Best trade idea
        const ideas = r.data.composite?.trade_ideas || [];
        const bestIdea = ideas[0];
        let ideaHtml = '<span style="color:var(--text-dim);font-size:0.7rem;">No ideas</span>';
        if (bestIdea) {
            const confClass = bestIdea.confidence ? `confidence-${bestIdea.confidence}` : '';
            const typeIcon = bestIdea.type === 'bullish' ? '&#9650;' : bestIdea.type === 'bearish' ? '&#9660;' : '&#9644;';
            ideaHtml = `<span style="font-size:0.72rem;">${typeIcon} ${bestIdea.title}</span>
                <span class="trade-idea-confidence ${confClass}" style="font-size:0.6rem;margin-left:4px;">${(bestIdea.confidence || '').toUpperCase()}</span>`;
        }

        // Mode-specific highlight badges
        let badges = '';
        if (mode === 'buycalls') {
            const netFlow = (r.data.smart_money?.net_flow || '').toLowerCase();
            if (netFlow === 'bullish') badges += '<span class="signal-highlight">BULL FLOW</span>';
            const sqDir = (r.data.squeeze_pin?.direction || '').toUpperCase();
            if (sqDir === 'UP') badges += '<span class="signal-highlight">SQ UP</span>';
        } else if (mode === 'sellpremium') {
            const pin = r.data.squeeze_pin?.pin_score ?? 0;
            if (pin >= 30) badges += `<span class="signal-highlight">PIN ${pin}</span>`;
            const lbl = (r.data.composite?.label || '').toUpperCase();
            if (lbl === 'NEUTRAL') badges += '<span class="signal-highlight">NEUTRAL</span>';
        } else if (mode === 'squeeze') {
            const sq = r.data.squeeze_pin?.squeeze_score ?? 0;
            const sqDir = (r.data.squeeze_pin?.direction || '').toUpperCase();
            badges += `<span class="signal-highlight">SQ ${sq} ${sqDir}</span>`;
        } else if (mode === 'momentum') {
            const airPockets = r.data.dealer_hedging?.air_pockets?.length || 0;
            if (airPockets > 0) badges += `<span class="signal-highlight">${airPockets} AIR PKT</span>`;
            const breakouts = ideas.filter(i => i.type === 'breakout').length;
            if (breakouts > 0) badges += '<span class="signal-highlight">BREAKOUT</span>';
        }

        const priceStr = r.price ? '$' + (r.price >= 1000 ? r.price.toFixed(0) : r.price.toFixed(2)) : '--';

        return `<div class="scanner-row${idx === 0 ? ' active' : ''}" onclick="scannerDrillDown('${r.ticker}', ${idx})" data-idx="${idx}">
            <div class="scanner-rank" style="background:${rankColor}">${idx + 1}</div>
            <div class="scanner-ticker">${r.ticker}</div>
            <div class="scanner-price">${priceStr}</div>
            <div class="scanner-sscore-cell">
                <span class="scanner-sscore-value" style="color:${ssColor}">${ss}</span>
            </div>
            <div class="scanner-score-cell">
                <div class="scanner-score-ring" style="border-color:${scoreColor}">
                    <span style="color:${scoreColor}">${score}</span>
                </div>
                <span class="scanner-score-label" style="color:${scoreColor}">${label}</span>
            </div>
            <div class="scanner-conviction">
                <span class="conviction-dots">${dotsHtml}</span>
                ${convCountHtml}
            </div>
            <div class="scanner-idea">${ideaHtml}${badges}</div>
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
        const cards = ideas.map(idea => {
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
        ideasHtml = `<div style="margin-bottom:16px;"><div class="trade-ideas-title">TRADE IDEAS</div>${cards}</div>`;
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

    // Scanner score badge
    const ss = entry.scannerScore ?? computeScannerScore(d);
    const ssColor = ss >= 75 ? 'var(--green)' : ss >= 55 ? 'var(--blue)' : ss >= 40 ? 'var(--orange)' : 'var(--red)';

    // Conviction detail chips
    const conv = entry.conviction || computeConviction(d);
    const convChips = conv.signals.map(s => {
        const cls = s.dir === 'bullish' ? 'bullish' : s.dir === 'bearish' ? 'bearish' : 'neutral-sig';
        const arrow = s.dir === 'bullish' ? '&#9650;' : s.dir === 'bearish' ? '&#9660;' : '&#9644;';
        return `<span class="conviction-signal ${cls}">${arrow} ${s.name}</span>`;
    }).join('');
    const convSummary = `${conv.bullish} bullish / ${conv.bearish} bearish / ${conv.total - conv.bullish - conv.bearish} neutral`;

    detailEl.innerHTML = `
        <div class="card-header">
            <div class="card-title">X-RAY DETAIL <span style="color:var(--cyan);margin-left:8px;">${ticker}</span></div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="scanner-sscore-badge" style="background:rgba(217,70,239,0.15);color:var(--magenta);">SCANNER: ${ss}</span>
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

console.log('Gamma Quantix initialized. API:', API_BASE);
