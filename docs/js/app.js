// Gamma Quantix - Complete Options Flow & GEX Analysis
// Version: 2.0.0
console.log('Gamma Quantix v2.0.0 loaded');

// API Configuration
const API_BASE = 'https://zhuanleee--stockstory-api-create-fastapi-app.modal.run';

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

    // Load market sentiment
    loadMarketSentiment();
    updateMarketStatus();

    // Update market status every minute
    setInterval(updateMarketStatus, 60000);
});

// =============================================================================
// MARKET STATUS
// =============================================================================
function updateMarketStatus() {
    const now = new Date();
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
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
        let maxPainData = {};
        if (maxPainRes && maxPainRes.ok) {
            maxPainData = await maxPainRes.json();
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

        // Load Ratio Spread Score
        loadRatioSpreadScore();

        // Load Options Visualization
        loadOptionsViz(ticker);

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

    // Reset fields
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
        const [regimeRes, levelsRes, combinedRes] = await Promise.all([
            fetch(isFutures
                ? `${API_BASE}/options/gex-regime?ticker=${encodeURIComponent(ticker)}${expiryParam}`
                : `${API_BASE}/options/gex-regime/${ticker}${expiry ? '?expiration=' + expiry : ''}`),
            fetch(isFutures
                ? `${API_BASE}/options/gex-levels?ticker=${encodeURIComponent(ticker)}${expiryParam}`
                : `${API_BASE}/options/gex-levels/${ticker}${expiry ? '?expiration=' + expiry : ''}`),
            fetch(isFutures
                ? `${API_BASE}/options/combined-regime?ticker=${encodeURIComponent(ticker)}${expiryParam}`
                : `${API_BASE}/options/combined-regime/${ticker}${expiry ? '?expiration=' + expiry : ''}`)
        ]);

        const regimeData = await regimeRes.json();
        const levelsData = await levelsRes.json();
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
                c.position_sizing ? `${(c.position_sizing * 100).toFixed(0)}%` : '--';
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
        <div style="background: var(--bg-hover); border-radius: 8px; padding: 16px; margin-top: 16px;">
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
async function loadRatioSpreadScore() {
    const ticker = optionsAnalysisTicker;
    if (!ticker) return;

    const targetDTE = document.getElementById('ratio-dte-select')?.value || '120';
    const container = document.getElementById('ratio-spread-container');
    container.style.display = 'block';
    document.getElementById('ratio-ticker').textContent = `${ticker} @ ${targetDTE} DTE`;

    document.getElementById('ratio-total-score').textContent = '-';
    document.getElementById('ratio-verdict').textContent = 'Loading...';
    document.getElementById('ratio-recommendation').textContent = 'Analyzing conditions...';

    try {
        const isFutures = ticker.startsWith('/');
        const response = await fetch(isFutures
            ? `${API_BASE}/options/ratio-spread-score-v2?ticker=${encodeURIComponent(ticker)}&target_dte=${targetDTE}`
            : `${API_BASE}/options/ratio-spread-score-v2/${ticker}?target_dte=${targetDTE}`);
        const data = await response.json();

        if (!data.ok || !data.data) {
            throw new Error(data.error || 'Failed to load ratio spread score');
        }

        const d = data.data;
        const scores = d.scores || {};

        document.getElementById('ratio-total-score').textContent = d.total_score;

        const verdictEl = document.getElementById('ratio-verdict');
        const bannerEl = document.getElementById('ratio-verdict-banner');
        verdictEl.textContent = d.verdict;

        const verdictColors = {
            'HIGH_CONVICTION': { bg: 'rgba(34, 197, 94, 0.15)', border: 'var(--green)', text: 'var(--green)' },
            'FAVORABLE': { bg: 'rgba(59, 130, 246, 0.15)', border: 'var(--blue)', text: 'var(--blue)' },
            'NEUTRAL': { bg: 'rgba(251, 191, 36, 0.15)', border: 'var(--orange)', text: 'var(--orange)' },
            'UNFAVORABLE': { bg: 'rgba(239, 68, 68, 0.1)', border: 'var(--red)', text: 'var(--red)' },
            'AVOID': { bg: 'rgba(239, 68, 68, 0.2)', border: 'var(--red)', text: 'var(--red)' }
        };
        const colors = verdictColors[d.verdict] || verdictColors['NEUTRAL'];
        bannerEl.style.background = colors.bg;
        bannerEl.style.borderLeft = `4px solid ${colors.border}`;
        verdictEl.style.color = colors.text;

        document.getElementById('ratio-recommendation').textContent = d.recommendation;
        document.getElementById('ratio-risk-level').textContent = d.risk_level;
        document.getElementById('ratio-position-size').textContent = d.position_size;

        const riskEl = document.getElementById('ratio-risk-level');
        if (d.risk_level === 'low') riskEl.style.color = 'var(--green)';
        else if (d.risk_level === 'moderate') riskEl.style.color = 'var(--blue)';
        else if (d.risk_level === 'elevated') riskEl.style.color = 'var(--orange)';
        else riskEl.style.color = 'var(--red)';

        const dataSourceEl = document.getElementById('ratio-data-source');
        const dataSource = d.data_source || 'polygon';
        dataSourceEl.textContent = dataSource === 'tastytrade' ? 'Tastytrade' : 'Polygon';
        dataSourceEl.style.color = dataSource === 'tastytrade' ? 'var(--green)' : 'var(--yellow)';

        // Update factor cards
        const updateFactorCard = (id, scoreData, valueFormatter) => {
            const card = document.getElementById(`ratio-${id}-card`);
            const checkEl = document.getElementById(`ratio-${id}-check`);
            const valueEl = document.getElementById(`ratio-${id}-value`);
            const labelEl = document.getElementById(`ratio-${id}-label`);

            if (!card || !checkEl || !valueEl || !labelEl) return;

            if (scoreData.error) {
                checkEl.innerHTML = '&#10060;';
                valueEl.textContent = 'Error';
                labelEl.textContent = scoreData.error;
                card.style.borderLeftColor = 'var(--red)';
                return;
            }

            checkEl.innerHTML = scoreData.pass ? '&#9989;' : '&#11036;';
            valueEl.textContent = valueFormatter(scoreData);
            labelEl.textContent = scoreData.label || '';
            card.style.borderLeftColor = scoreData.pass ? 'var(--green)' : 'var(--border)';
        };

        if (scores.vrp) {
            updateFactorCard('vrp', scores.vrp, s => s.value !== undefined ? `${s.value > 0 ? '+' : ''}${s.value.toFixed(1)}%` : '--');
        }
        if (scores.skew) {
            updateFactorCard('skew', scores.skew, s => s.value ? `${((s.value - 1) * 100).toFixed(1)}%` : '--');
        }
        if (scores.term_structure) {
            updateFactorCard('term', scores.term_structure, s => s.signal || '--');
        }
        if (scores.gex) {
            updateFactorCard('gex', scores.gex, s => s.signal ? s.signal.toUpperCase() : '--');
        }
        if (scores.rv_direction) {
            updateFactorCard('rv', scores.rv_direction, s => s.signal || '--');
        }
        if (scores.expected_move) {
            updateFactorCard('em', scores.expected_move, s => s.label || '--');
        }

        // Detail values
        if (d.vrp_data) {
            document.getElementById('ratio-iv-30d').textContent = `${d.vrp_data.iv_30d_pct}%`;
            document.getElementById('ratio-rv-20d').textContent = d.vrp_data.rv_20d_pct ? `${d.vrp_data.rv_20d_pct}%` : '--';
        }
        if (d.skew_data) {
            document.getElementById('ratio-atm-iv').textContent = `${d.skew_data.atm_iv_pct}%`;
            document.getElementById('ratio-25d-iv').textContent = d.skew_data.otm_25d_iv_pct ? `${d.skew_data.otm_25d_iv_pct}%` : '--';
        }
        if (d.em_data) {
            document.getElementById('ratio-em-lower').textContent = `$${d.em_data.lower_expected}`;
            document.getElementById('ratio-em-1-5x').textContent = `$${d.em_data.lower_1_5x_em}`;
            document.getElementById('ratio-em-2x').textContent = `$${d.em_data.lower_2x_em}`;
            document.getElementById('ratio-dte').textContent = d.em_data.dte ? `${d.em_data.dte}d` : '--';
        }

        const factors = d.passing_factors || [];
        document.getElementById('ratio-passing-factors').textContent =
            factors.length > 0 ? factors.join(' | ') : 'No factors passing - unfavorable conditions';

        console.log('Ratio Spread Score loaded for', ticker);

    } catch (e) {
        console.error('Ratio Spread Score error:', e);
        document.getElementById('ratio-verdict').textContent = 'ERROR';
        document.getElementById('ratio-recommendation').textContent = 'Error: ' + e.message;
    }
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
        const days = 30;

        const gexLevelsUrl = isFutures
            ? `${API_BASE}/options/gex-levels?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/gex-levels/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        const gexUrl = isFutures
            ? `${API_BASE}/options/gex?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/gex/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        const maxPainUrl = isFutures
            ? `${API_BASE}/options/max-pain?ticker=${tickerParam}${expiry ? '&expiration=' + expiry : ''}`
            : `${API_BASE}/options/max-pain/${ticker}${expiry ? '?expiration=' + expiry : ''}`;

        const candlesUrl = `${API_BASE}/market/candles?ticker=${tickerParam}&days=${days}`;
        const volumeProfileUrl = `${API_BASE}/volume-profile/${isFutures ? 'SPY' : ticker}?days=30`;

        const [gexLevelsRes, gexRes, maxPainRes, candlesRes, vpRes] = await Promise.all([
            fetch(gexLevelsUrl),
            fetch(gexUrl),
            fetch(maxPainUrl),
            fetch(candlesUrl).catch(e => null),
            fetch(volumeProfileUrl).catch(e => null)
        ]);

        if (!gexLevelsRes.ok) throw new Error(`GEX Levels API error: ${gexLevelsRes.status}`);
        if (!gexRes.ok) throw new Error(`GEX API error: ${gexRes.status}`);
        if (!maxPainRes.ok) throw new Error(`Max Pain API error: ${maxPainRes.status}`);

        const gexLevelsData = await gexLevelsRes.json();
        const gexData = await gexRes.json();
        const maxPainData = await maxPainRes.json();

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
                optionsVizData.candles = candles.map(c => ({
                    time: c.time || c.date || c.t,
                    open: c.open || c.o,
                    high: c.high || c.h,
                    low: c.low || c.l,
                    close: c.close || c.c
                })).filter(c => c.time && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
            } catch (e) {
                console.error('Error parsing candle data:', e);
                optionsVizData.candles = [];
            }
        } else {
            optionsVizData.candles = [];
        }

        // Parse volume profile
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

    if (priceChart) {
        priceChart.remove();
        priceChart = null;
        priceSeries = null;
        priceLines = {};
    }

    if (!optionsVizData.candles || optionsVizData.candles.length === 0) {
        container.innerHTML = '<div class="chart-loading">No price data available</div>';
        return;
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
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
        timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true },
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

    updatePriceChartLevels();

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
    if (livePriceInterval) {
        clearInterval(livePriceInterval);
    }

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

            if (price && price > 0 && priceSeries) {
                updateLivePrice(price);
            }
        } catch (e) {}
    }, 5000);

    updateLivePrice(optionsVizData.currentPrice);
}

function updateLivePrice(price) {
    if (!priceSeries || !price || price <= 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(today.getTime() / 1000);

    const lastCandle = optionsVizData.candles[optionsVizData.candles.length - 1];

    if (lastCandle && lastCandle.time >= todayTimestamp) {
        const updatedCandle = {
            time: lastCandle.time,
            open: lastCandle.open,
            high: Math.max(lastCandle.high, price),
            low: Math.min(lastCandle.low, price),
            close: price
        };
        priceSeries.update(updatedCandle);
        optionsVizData.candles[optionsVizData.candles.length - 1] = updatedCandle;
    } else {
        const newCandle = {
            time: todayTimestamp,
            open: price,
            high: price,
            low: price,
            close: price
        };
        priceSeries.update(newCandle);
    }

    optionsVizData.currentPrice = price;
    const priceEl = document.getElementById('viz-current-price');
    if (priceEl) {
        priceEl.textContent = `$${price.toFixed(2)}`;
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
    loadOptionsViz(ticker);
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
        needle.setAttribute('transform', `rotate(${angle}, 90, 85)`);
    }

    const label = document.getElementById('sentiment-label');
    const description = document.getElementById('sentiment-description');

    if (score >= 75) {
        label.textContent = 'BULLISH';
        label.style.color = 'var(--green)';
        description.textContent = 'Low P/C + Low VIX = Risk On';
    } else if (score >= 60) {
        label.textContent = 'LEAN BULLISH';
        label.style.color = 'var(--green)';
        description.textContent = 'Slightly bullish positioning';
    } else if (score >= 40) {
        label.textContent = 'NEUTRAL';
        label.style.color = 'var(--text)';
        description.textContent = 'Mixed signals';
    } else if (score >= 25) {
        label.textContent = 'LEAN BEARISH';
        label.style.color = 'var(--red)';
        description.textContent = 'Elevated caution';
    } else {
        label.textContent = 'BEARISH';
        label.style.color = 'var(--red)';
        description.textContent = 'High P/C + High VIX = Risk Off';
    }
}

// =============================================================================
// WHALE TRADES
// =============================================================================
async function loadWhaleTrades() {
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

        // Populate summary stats
        const summary = chain.summary || {};
        const sentiment = summary.sentiment || 'neutral';
        const sentimentColor = sentiment === 'bullish' ? 'var(--green)' :
                              sentiment === 'bearish' ? 'var(--red)' :
                              'var(--text-muted)';

        document.getElementById('opt-sentiment').textContent = sentiment.toUpperCase();
        document.getElementById('opt-sentiment').style.color = sentimentColor;
        document.getElementById('opt-pc-ratio').textContent = (summary.put_call_volume_ratio || summary.put_call_ratio || 0).toFixed(2);
        document.getElementById('opt-call-vol').textContent = (summary.total_call_volume || 0).toLocaleString();
        document.getElementById('opt-put-vol').textContent = (summary.total_put_volume || 0).toLocaleString();

        // Render calls table
        const calls = chain.calls || [];
        if (calls.length === 0) {
            document.getElementById('calls-table-body').innerHTML =
                '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">No call contracts available</td></tr>';
        } else {
            document.getElementById('calls-table-body').innerHTML = calls.slice(0, 50).map(c => {
                const deltaColor = (c.delta || 0) >= 0.5 ? 'var(--green)' : 'var(--text-muted)';
                return `<tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 8px; font-weight: 600;">$${c.strike || '--'}</td>
                    <td style="padding: 8px; text-align: right;">$${(c.bid || 0).toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">$${(c.ask || 0).toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">${(c.volume || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${(c.open_interest || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${c.implied_volatility ? (c.implied_volatility * 100).toFixed(1) + '%' : '--'}</td>
                    <td style="padding: 8px; text-align: right; color: ${deltaColor}; font-weight: 600;">${c.delta ? c.delta.toFixed(3) : '--'}</td>
                </tr>`;
            }).join('');
        }

        // Render puts table
        const puts = chain.puts || [];
        if (puts.length === 0) {
            document.getElementById('puts-table-body').innerHTML =
                '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">No put contracts available</td></tr>';
        } else {
            document.getElementById('puts-table-body').innerHTML = puts.slice(0, 50).map(p => {
                const deltaColor = (p.delta || 0) <= -0.5 ? 'var(--red)' : 'var(--text-muted)';
                return `<tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 8px; font-weight: 600;">$${p.strike || '--'}</td>
                    <td style="padding: 8px; text-align: right;">$${(p.bid || 0).toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">$${(p.ask || 0).toFixed(2)}</td>
                    <td style="padding: 8px; text-align: right;">${(p.volume || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${(p.open_interest || 0).toLocaleString()}</td>
                    <td style="padding: 8px; text-align: right;">${p.implied_volatility ? (p.implied_volatility * 100).toFixed(1) + '%' : '--'}</td>
                    <td style="padding: 8px; text-align: right; color: ${deltaColor}; font-weight: 600;">${p.delta ? p.delta.toFixed(3) : '--'}</td>
                </tr>`;
            }).join('');
        }

        console.log('Options chain loaded for', ticker);

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
async function runOptionsScreener() {
    const container = document.getElementById('screener-results');
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Running screener...</div>';

    try {
        const minPremium = (document.getElementById('screener-min-premium').value || 50) * 1000;
        const minIv = document.getElementById('screener-min-iv').value || 0;
        const sentiment = document.getElementById('screener-sentiment').value;
        const tickers = document.getElementById('screener-tickers').value.trim().toUpperCase() || 'NVDA,AAPL,TSLA,META,AMD';

        let url = `${API_BASE}/options/screener?tickers=${tickers}&min_premium=${minPremium}&min_iv_rank=${minIv}`;
        if (sentiment) url += `&sentiment=${sentiment}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.ok && (data.results || data.data) && (data.results || data.data).length > 0) {
            const results = data.results || data.data;
            let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 12px;">';
            html += '<thead><tr style="background: var(--bg-hover); border-bottom: 1px solid var(--border);">';
            html += '<th style="padding: 10px; text-align: left;">Ticker</th>';
            html += '<th style="padding: 10px; text-align: left;">Type</th>';
            html += '<th style="padding: 10px; text-align: right;">Strike</th>';
            html += '<th style="padding: 10px; text-align: right;">Premium</th>';
            html += '<th style="padding: 10px; text-align: right;">IV Rank</th>';
            html += '<th style="padding: 10px; text-align: center;">Sentiment</th>';
            html += '</tr></thead><tbody>';

            results.slice(0, 20).forEach(r => {
                const sentColor = r.sentiment === 'bullish' ? 'var(--green)' : r.sentiment === 'bearish' ? 'var(--red)' : 'var(--text-muted)';
                const premium = (r.premium || 0) / 1000;
                const ivRank = r.iv_rank || 0;

                html += `<tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px; font-weight: 600;">${r.ticker || '--'}</td>
                    <td style="padding: 10px;">${(r.type || 'C').toUpperCase()}</td>
                    <td style="padding: 10px; text-align: right;">$${(r.strike || 0).toLocaleString()}</td>
                    <td style="padding: 10px; text-align: right; font-weight: 600;">$${premium.toLocaleString(undefined, {maximumFractionDigits: 0})}K</td>
                    <td style="padding: 10px; text-align: right;">${ivRank.toFixed(0)}%</td>
                    <td style="padding: 10px; text-align: center; color: ${sentColor}; font-weight: 600; text-transform: uppercase;">${r.sentiment || 'neutral'}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No results match your filters</div>';
        }
    } catch (e) {
        console.error('Failed to run screener:', e);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red);">Screener failed: ' + e.message + '</div>';
    }
}

// =============================================================================
// SMART MONEY FLOW
// =============================================================================
async function loadSmartMoneyFlow() {
    // Use flow input, or fall back to options-ticker-input, or header ticker-input
    let ticker = document.getElementById('flow-ticker-input')?.value.trim().toUpperCase();
    if (!ticker) ticker = optionsAnalysisTicker;
    if (!ticker) ticker = document.getElementById('ticker-input')?.value.trim().toUpperCase();
    if (!ticker) {
        alert('Please enter a ticker symbol');
        return;
    }

    // Auto-fill the flow input for clarity
    const flowInput = document.getElementById('flow-ticker-input');
    if (flowInput) flowInput.value = ticker;

    // Auto-open the accordion if closed
    const accordions = document.querySelectorAll('.sidebar-accordion');
    accordions.forEach(acc => {
        const header = acc.querySelector('.accordion-header span:first-child');
        if (header && header.textContent.includes('Smart Money') && !acc.classList.contains('open')) {
            acc.classList.add('open');
        }
    });

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

console.log('Gamma Quantix initialized. API:', API_BASE);
