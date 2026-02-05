// Gamma Quantix - Options Flow & GEX Analysis
// Version: 1.0.0
console.log('📊 Gamma Quantix v1.0.0 loaded');

// API Base URL
const API_BASE = 'https://zhuanleee--stockstory-api-create-fastapi-app.modal.run';

// Global State
let currentTicker = 'SPY';
let currentExpiry = '';
let priceChart = null;
let priceSeries = null;
let priceLines = {};
let gexChart = null;
let livePriceInterval = null;

// Options Visualization Data
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set up enter key handler for ticker input
    document.getElementById('ticker-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') analyzeTicker();
    });

    // Load default ticker
    analyzeTicker('SPY');
    updateMarketStatus();

    // Update market status every minute
    setInterval(updateMarketStatus, 60000);
});

// Analyze ticker
async function analyzeTicker(ticker) {
    ticker = ticker || document.getElementById('ticker-input').value.trim().toUpperCase();
    if (!ticker) {
        alert('Please enter a ticker symbol');
        return;
    }

    currentTicker = ticker;
    document.getElementById('current-ticker').textContent = ticker;
    document.getElementById('viz-ticker-label').textContent = `- ${ticker}`;

    // Show loading state
    showLoading();

    try {
        // Fetch expirations first
        await loadExpirations(ticker);

        // Then load all data
        await loadOptionsData(ticker);

    } catch (error) {
        console.error('Error analyzing ticker:', error);
        showError(error.message);
    }
}

// Load expirations
async function loadExpirations(ticker) {
    const select = document.getElementById('expiry-select');
    select.innerHTML = '<option value="">Loading...</option>';

    try {
        const isFutures = ticker.startsWith('/');
        const tickerParam = encodeURIComponent(ticker);
        const url = isFutures
            ? `${API_BASE}/options/expirations?ticker=${tickerParam}`
            : `${API_BASE}/options/expirations/${ticker}`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.ok || !data.data || !data.data.expirations) {
            throw new Error('Failed to load expirations');
        }

        const expirations = data.data.expirations;
        select.innerHTML = expirations.map((exp, idx) => {
            const d = new Date(exp + 'T00:00:00');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const daysOut = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const label = daysOut <= 0 ? `${months[d.getMonth()]} ${d.getDate()} (0DTE)` :
                         daysOut === 1 ? `${months[d.getMonth()]} ${d.getDate()} (1d)` :
                         `${months[d.getMonth()]} ${d.getDate()} (${daysOut}d)`;
            return `<option value="${exp}" ${idx === 0 ? 'selected' : ''}>${label}</option>`;
        }).join('');

        currentExpiry = expirations[0];
        document.getElementById('ticker-expiry').textContent = `Exp: ${currentExpiry}`;

    } catch (error) {
        console.error('Error loading expirations:', error);
        select.innerHTML = '<option value="">Error loading</option>';
    }
}

// On expiry change
async function onExpiryChange() {
    currentExpiry = document.getElementById('expiry-select').value;
    document.getElementById('ticker-expiry').textContent = `Exp: ${currentExpiry}`;
    await loadOptionsData(currentTicker);
}

// On timeframe change
async function onTimeframeChange() {
    await loadOptionsData(currentTicker);
}

// Refresh data
async function refreshData() {
    await loadOptionsData(currentTicker);
}

// Load all options data
async function loadOptionsData(ticker) {
    const isFutures = ticker.startsWith('/');
    const tickerParam = encodeURIComponent(ticker);
    const expiry = currentExpiry;
    const days = parseInt(document.getElementById('timeframe-select').value) || 30;

    // Build URLs
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

    try {
        // Fetch all data in parallel
        const [gexLevelsRes, gexRes, maxPainRes, candlesRes, vpRes] = await Promise.all([
            fetch(gexLevelsUrl),
            fetch(gexUrl),
            fetch(maxPainUrl),
            fetch(candlesUrl).catch(e => null),
            fetch(volumeProfileUrl).catch(e => null)
        ]);

        // Validate responses
        if (!gexLevelsRes.ok) throw new Error(`GEX Levels API error: ${gexLevelsRes.status}`);
        if (!gexRes.ok) throw new Error(`GEX API error: ${gexRes.status}`);
        if (!maxPainRes.ok) throw new Error(`Max Pain API error: ${maxPainRes.status}`);

        const gexLevelsData = await gexLevelsRes.json();
        const gexData = await gexRes.json();
        const maxPainData = await maxPainRes.json();

        // Parse candle data
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
                console.error('Error parsing candles:', e);
                optionsVizData.candles = [];
            }
        }

        // Parse volume profile data
        if (vpRes && vpRes.ok) {
            try {
                const vpData = await vpRes.json();
                if (vpData.ok && vpData.data) {
                    optionsVizData.val = vpData.data.val || 0;
                    optionsVizData.poc = vpData.data.poc || 0;
                    optionsVizData.vah = vpData.data.vah || 0;
                    const cp = vpData.data.current_price || 0;
                    if (cp > optionsVizData.vah) optionsVizData.vpPosition = 'Above VAH';
                    else if (cp < optionsVizData.val) optionsVizData.vpPosition = 'Below VAL';
                    else if (Math.abs(cp - optionsVizData.poc) < (optionsVizData.vah - optionsVizData.val) * 0.1) optionsVizData.vpPosition = 'At POC';
                    else optionsVizData.vpPosition = 'In Range';
                    console.log('📊 Volume Profile loaded:', { val: optionsVizData.val, poc: optionsVizData.poc, vah: optionsVizData.vah });
                }
            } catch (e) {
                console.warn('Error parsing volume profile:', e);
            }
        }

        // Extract GEX levels
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

        // Extract max pain
        const maxPain = maxPainData.data || {};
        optionsVizData.maxPain = maxPain.max_pain_price || maxPain.max_pain || maxPain.maxPain || 0;

        console.log('📊 Levels loaded:', {
            currentPrice: optionsVizData.currentPrice,
            callWall: optionsVizData.callWall,
            putWall: optionsVizData.putWall,
            gammaFlip: optionsVizData.gammaFlip,
            maxPain: optionsVizData.maxPain,
            val: optionsVizData.val,
            poc: optionsVizData.poc,
            vah: optionsVizData.vah
        });

        // Update UI
        updateSidebar();
        updateInfoBar();
        renderPriceChart();
        renderGexChart();
        renderGexTable();
        updateVolumeProfile();
        updateLastUpdate();

        // Start live updates
        startLivePriceUpdates();

    } catch (error) {
        console.error('Error loading options data:', error);
        showError(error.message);
    }
}

// Update sidebar
function updateSidebar() {
    // Price
    document.getElementById('ticker-price').textContent = optionsVizData.currentPrice > 0
        ? `$${optionsVizData.currentPrice.toFixed(2)}`
        : '--';

    // Key levels
    document.getElementById('sidebar-call-wall').textContent = optionsVizData.callWall > 0
        ? `$${optionsVizData.callWall.toFixed(2)}`
        : '--';
    document.getElementById('sidebar-put-wall').textContent = optionsVizData.putWall > 0
        ? `$${optionsVizData.putWall.toFixed(2)}`
        : '--';
    document.getElementById('sidebar-gamma-flip').textContent = optionsVizData.gammaFlip > 0
        ? `$${optionsVizData.gammaFlip.toFixed(2)}`
        : '--';
    document.getElementById('sidebar-max-pain').textContent = optionsVizData.maxPain > 0
        ? `$${optionsVizData.maxPain.toFixed(2)}`
        : '--';
    document.getElementById('sidebar-val').textContent = optionsVizData.val > 0
        ? `$${optionsVizData.val.toFixed(2)}`
        : '--';
    document.getElementById('sidebar-poc').textContent = optionsVizData.poc > 0
        ? `$${optionsVizData.poc.toFixed(2)}`
        : '--';
    document.getElementById('sidebar-vah').textContent = optionsVizData.vah > 0
        ? `$${optionsVizData.vah.toFixed(2)}`
        : '--';

    // GEX summary
    const gex = optionsVizData.totalGex;
    const gexDisplay = Math.abs(gex) >= 1e9 ? `$${(gex / 1e9).toFixed(1)}B` :
                      Math.abs(gex) >= 1e6 ? `$${(gex / 1e6).toFixed(1)}M` :
                      `$${gex.toFixed(0)}`;
    document.getElementById('sidebar-total-gex').textContent = gexDisplay;
    document.getElementById('sidebar-total-gex').style.color = gex > 0 ? 'var(--green)' : gex < 0 ? 'var(--red)' : 'var(--text)';

    document.getElementById('sidebar-pc-ratio').textContent = optionsVizData.pcRatio > 0
        ? optionsVizData.pcRatio.toFixed(2)
        : '--';

    // Sentiment
    const ratio = optionsVizData.pcRatio;
    let sentiment = 'Neutral';
    if (ratio < 0.7) sentiment = 'Bullish';
    else if (ratio > 1.0) sentiment = 'Bearish';
    document.getElementById('sidebar-sentiment').textContent = sentiment;
    document.getElementById('sidebar-sentiment').style.color =
        sentiment === 'Bullish' ? 'var(--green)' :
        sentiment === 'Bearish' ? 'var(--red)' : 'var(--text)';
}

// Update info bar
function updateInfoBar() {
    document.getElementById('viz-current-price').textContent = optionsVizData.currentPrice > 0
        ? `$${optionsVizData.currentPrice.toFixed(2)}`
        : '--';
    document.getElementById('viz-call-wall').textContent = optionsVizData.callWall > 0
        ? `$${optionsVizData.callWall.toFixed(0)}`
        : '--';
    document.getElementById('viz-put-wall').textContent = optionsVizData.putWall > 0
        ? `$${optionsVizData.putWall.toFixed(0)}`
        : '--';
    document.getElementById('viz-max-pain').textContent = optionsVizData.maxPain > 0
        ? `$${optionsVizData.maxPain.toFixed(0)}`
        : '--';

    const gex = optionsVizData.totalGex;
    const gexDisplay = Math.abs(gex) >= 1e9 ? `$${(gex / 1e9).toFixed(1)}B` :
                      Math.abs(gex) >= 1e6 ? `$${(gex / 1e6).toFixed(1)}M` :
                      `$${gex.toFixed(0)}`;
    document.getElementById('viz-total-gex').textContent = gexDisplay;
    document.getElementById('viz-total-gex').style.color = gex > 0 ? 'var(--green)' : gex < 0 ? 'var(--red)' : 'var(--text)';
}

// Render price chart
function renderPriceChart() {
    const container = document.getElementById('price-chart-container');

    // Clean up existing chart
    if (priceChart) {
        priceChart.remove();
        priceChart = null;
        priceSeries = null;
        priceLines = {};
    }

    // Check if candle data available
    if (!optionsVizData.candles || optionsVizData.candles.length === 0) {
        container.innerHTML = '<div class="chart-loading">No price data available</div>';
        return;
    }

    container.innerHTML = '';

    // Create chart
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

    // Add candlestick series
    priceSeries = priceChart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
    });

    priceSeries.setData(optionsVizData.candles);

    // Add level lines
    updatePriceChartLevels();

    // Fit content
    priceChart.timeScale().fitContent();

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
        if (priceChart && container.clientWidth > 0) {
            priceChart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight || 300
            });
        }
    });
    resizeObserver.observe(container);
}

// Update price chart levels
function updatePriceChartLevels() {
    if (!priceSeries) {
        console.warn('updatePriceChartLevels: priceSeries not available');
        return;
    }

    console.log('🎯 updatePriceChartLevels called with:', {
        callWall: optionsVizData.callWall,
        putWall: optionsVizData.putWall,
        gammaFlip: optionsVizData.gammaFlip,
        maxPain: optionsVizData.maxPain,
        val: optionsVizData.val,
        poc: optionsVizData.poc,
        vah: optionsVizData.vah
    });

    // Remove existing lines
    Object.values(priceLines).forEach(line => {
        if (line) {
            try { priceSeries.removePriceLine(line); } catch (e) {}
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

// Toggle GEX chart visibility
function toggleGexChart() {
    const container = document.getElementById('gex-chart-container');
    const show = document.getElementById('viz-toggle-gex')?.checked ?? true;
    container.style.display = show ? 'block' : 'none';
}

// Render GEX chart
function renderGexChart() {
    const container = document.getElementById('gex-chart-container');

    if (!optionsVizData.gexByStrike || optionsVizData.gexByStrike.length === 0) {
        container.innerHTML = '<div class="chart-loading">No GEX data available</div>';
        return;
    }

    // Filter strikes around current price
    let data = optionsVizData.gexByStrike.slice();
    const currentPrice = optionsVizData.currentPrice;
    if (currentPrice > 0) {
        const range = currentPrice * 0.05; // 5% range
        data = data.filter(d => d.strike >= currentPrice - range && d.strike <= currentPrice + range);
    }
    data = data.slice(0, 30); // Max 30 strikes

    const strikes = data.map(d => d.strike);
    const netGexData = data.map(d => (d.netGex / 1e6)); // Convert to millions

    // Destroy existing chart
    if (gexChart) {
        gexChart.destroy();
        gexChart = null;
    }

    const options = {
        series: [{
            name: 'Net GEX ($M)',
            data: netGexData
        }],
        chart: {
            type: 'bar',
            height: 250,
            background: 'transparent',
            toolbar: { show: false },
            animations: { enabled: false }
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '70%',
                colors: {
                    ranges: [{
                        from: -Infinity,
                        to: 0,
                        color: '#ef4444'
                    }, {
                        from: 0,
                        to: Infinity,
                        color: '#22c55e'
                    }]
                }
            }
        },
        dataLabels: { enabled: false },
        xaxis: {
            categories: strikes.map(s => s.toFixed(0)),
            labels: {
                style: { colors: '#71717a', fontSize: '10px' },
                rotate: -45,
                rotateAlways: true
            },
            axisBorder: { color: '#2a2a3a' },
            axisTicks: { color: '#2a2a3a' }
        },
        yaxis: {
            labels: {
                style: { colors: '#71717a', fontSize: '10px' },
                formatter: val => `$${val.toFixed(1)}M`
            }
        },
        grid: {
            borderColor: '#2a2a3a',
            strokeDashArray: 3
        },
        tooltip: {
            theme: 'dark',
            y: { formatter: val => `$${val.toFixed(2)}M` }
        },
        annotations: {
            xaxis: []
        }
    };

    // Add current price annotation
    if (currentPrice > 0 && strikes.includes(Math.round(currentPrice))) {
        options.annotations.xaxis.push({
            x: Math.round(currentPrice).toFixed(0),
            borderColor: '#3b82f6',
            label: {
                text: 'Price',
                style: { color: '#fff', background: '#3b82f6' }
            }
        });
    }

    gexChart = new ApexCharts(container, options);
    gexChart.render();
}

// Render GEX table
function renderGexTable() {
    const tbody = document.getElementById('gex-table-body');
    const countEl = document.getElementById('gex-levels-count');

    if (!optionsVizData.gexByStrike || optionsVizData.gexByStrike.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No data</td></tr>';
        if (countEl) countEl.textContent = '0 levels';
        return;
    }

    // Sort by absolute net GEX
    const sorted = [...optionsVizData.gexByStrike]
        .sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))
        .slice(0, 20);

    tbody.innerHTML = sorted.map(row => {
        const netGexM = row.netGex / 1e6;
        const callGexM = row.callGex / 1e6;
        const putGexM = row.putGex / 1e6;
        const netColor = netGexM > 0 ? 'var(--green)' : 'var(--red)';

        return `
            <tr>
                <td>$${row.strike.toFixed(0)}</td>
                <td style="color: var(--green);">${callGexM.toFixed(2)}M</td>
                <td style="color: var(--red);">${putGexM.toFixed(2)}M</td>
                <td style="color: ${netColor};">${netGexM.toFixed(2)}M</td>
                <td>${row.callOI.toLocaleString()}</td>
                <td>${row.putOI.toLocaleString()}</td>
            </tr>
        `;
    }).join('');

    if (countEl) countEl.textContent = `${sorted.length} levels`;
}

// Update volume profile display
function updateVolumeProfile() {
    const container = document.getElementById('volume-profile-container');
    const posEl = document.getElementById('vp-position');
    const rangeEl = document.getElementById('vp-range');

    if (optionsVizData.val > 0 && optionsVizData.vah > 0) {
        const cp = optionsVizData.currentPrice;
        const val = optionsVizData.val;
        const vah = optionsVizData.vah;
        const poc = optionsVizData.poc;

        // Position color
        let posColor = 'var(--text)';
        if (cp > vah) posColor = 'var(--green)';
        else if (cp < val) posColor = 'var(--red)';
        else if (Math.abs(cp - poc) < (vah - val) * 0.1) posColor = 'var(--blue)';

        posEl.textContent = `$${cp.toFixed(2)} - ${optionsVizData.vpPosition}`;
        posEl.style.color = posColor;

        // Visual range bar
        const rangeSize = vah - val;
        const extendedLow = val - rangeSize * 0.3;
        const extendedHigh = vah + rangeSize * 0.3;
        const totalRange = extendedHigh - extendedLow;

        const valPct = ((val - extendedLow) / totalRange) * 100;
        const vahPct = ((vah - extendedLow) / totalRange) * 100;
        const pocPct = ((poc - extendedLow) / totalRange) * 100;
        const cpPct = Math.min(100, Math.max(0, ((cp - extendedLow) / totalRange) * 100));

        rangeEl.innerHTML = `
            <div style="position: absolute; left: ${valPct}%; right: ${100-vahPct}%; top: 0; bottom: 0; background: rgba(139, 92, 246, 0.25); border-left: 2px solid rgba(139, 92, 246, 0.6); border-right: 2px solid rgba(139, 92, 246, 0.6);"></div>
            <div style="position: absolute; left: ${pocPct}%; top: 0; bottom: 0; width: 2px; background: #d946ef;" title="POC: $${poc.toFixed(2)}"></div>
            <div style="position: absolute; left: ${cpPct}%; top: 50%; transform: translate(-50%, -50%); width: 10px; height: 10px; background: ${posColor}; border: 2px solid white; border-radius: 50%;" title="Current: $${cp.toFixed(2)}"></div>
        `;
    } else {
        posEl.textContent = 'Loading...';
        rangeEl.innerHTML = '';
    }
}

// Start live price updates
function startLivePriceUpdates() {
    if (livePriceInterval) clearInterval(livePriceInterval);

    livePriceInterval = setInterval(async () => {
        try {
            const isFutures = currentTicker.startsWith('/');
            const tickerParam = encodeURIComponent(currentTicker);
            const url = isFutures
                ? `${API_BASE}/quote?ticker=${tickerParam}`
                : `${API_BASE}/quote/${currentTicker}`;

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

// Update live price
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
    }

    optionsVizData.currentPrice = price;
    document.getElementById('ticker-price').textContent = `$${price.toFixed(2)}`;
    document.getElementById('viz-current-price').textContent = `$${price.toFixed(2)}`;
}

// Update market status
function updateMarketStatus() {
    const now = new Date();
    const hours = now.getHours();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    const isMarketHours = hours >= 9 && hours < 16;
    const isOpen = !isWeekend && isMarketHours;

    const dot = document.querySelector('.status-dot');
    const text = document.getElementById('status-text');

    if (isOpen) {
        dot.classList.remove('closed');
        text.textContent = 'Market Open';
    } else {
        dot.classList.add('closed');
        text.textContent = 'Market Closed';
    }
}

// Update last update time
function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').textContent = `Last update: ${now.toLocaleTimeString()}`;
}

// Show loading state
function showLoading() {
    document.getElementById('price-chart-container').innerHTML = '<div class="chart-loading"><span class="loading-spinner"></span> Loading...</div>';
    document.getElementById('gex-chart-container').innerHTML = '<div class="chart-loading"><span class="loading-spinner"></span> Loading...</div>';
    document.getElementById('gex-table-body').innerHTML = '<tr><td colspan="6" class="loading">Loading...</td></tr>';
}

// Show error
function showError(message) {
    const errorHtml = `<div class="chart-loading" style="color: var(--red);">Error: ${message}</div>`;
    document.getElementById('price-chart-container').innerHTML = errorHtml;
    document.getElementById('gex-chart-container').innerHTML = errorHtml;
}
