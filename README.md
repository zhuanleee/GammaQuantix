# Gamma Quantix

📊 **Options Flow & GEX Analysis Dashboard**

A real-time options visualization tool that displays Gamma Exposure (GEX), key levels, and volume profile data for stocks and futures.

## Features

- **Real-time Price Chart** with Lightweight Charts
- **GEX Levels Visualization**:
  - Call Wall
  - Put Wall
  - Gamma Flip
  - Max Pain
- **Volume Profile Levels**:
  - VAL (Value Area Low)
  - POC (Point of Control)
  - VAH (Value Area High)
- **GEX by Strike Chart** using ApexCharts
- **Live Price Updates** (5-second polling)
- **Support for Stocks and Futures** (SPY, /ES, /NQ, etc.)

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Charts**:
  - [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) v3.8.0 for price charts
  - [ApexCharts](https://apexcharts.com/) for GEX bar charts
- **Data Sources**: Tastytrade, Polygon

## Getting Started

### Option 1: GitHub Pages
Visit the live site: [https://yourusername.github.io/GammaQuantix](https://yourusername.github.io/GammaQuantix)

### Option 2: Local Development
1. Clone the repository
2. Open `docs/index.html` in your browser
3. Or use a local server:
   ```bash
   cd docs
   python -m http.server 8080
   ```
   Then visit `http://localhost:8080`

## Usage

1. Enter a ticker symbol (e.g., `SPY`, `AAPL`, `/ES`, `/NQ`)
2. Click "Analyze" or press Enter
3. Select an expiration date from the dropdown
4. Toggle chart levels on/off using the checkboxes

## Chart Levels

| Level | Color | Description |
|-------|-------|-------------|
| Call Wall | Red (dashed) | Highest call gamma strike - resistance |
| Put Wall | Green (dashed) | Highest put gamma strike - support |
| Gamma Flip | Orange (dotted) | Zero gamma level - volatility inflection |
| Max Pain | Purple (dotted) | Maximum options pain price |
| VAL | Cyan (dashed) | Value Area Low - support |
| POC | Magenta (solid) | Point of Control - fair value |
| VAH | Cyan (dashed) | Value Area High - resistance |

## API

The app uses the StockStory API for data:
- `/options/gex-levels/{ticker}` - GEX levels
- `/options/gex/{ticker}` - GEX by strike
- `/options/max-pain/{ticker}` - Max pain calculation
- `/market/candles` - OHLC price data
- `/volume-profile/{ticker}` - Volume profile (VAL/POC/VAH)

## License

MIT License
