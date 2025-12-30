import axios from 'axios';

interface BybitFundingRate {
    symbol: string;
    fundingRate: string;
    fundingRateTimestamp: string;
}

interface BybitInstrumentsInfo {
    symbol: string;
    contractType: string;
    status: string;
}

interface CoinFundingRate {
    symbol: string;
    rate: number;
    timestamp: number;
}

// NEW: Order book interfaces
interface OrderBookLevel {
    price: string;
    size: string;
}

interface OrderBookData {
    symbol: string;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

interface SlippageAnalysis {
    avgPrice: number;
    bestPrice: number;
    slippagePercent: number;
    slippageUSDT: number;
    totalQuantity: number;
    priceImpact: number;
}

const MAKER_FEE_RATE = 0.0002; // 0.02% as a default maker fee for perpetuals
const BYBIT_API_BASE = 'https://api.bybit.com/v5/market';

async function fetchAllPerpetualSymbols(): Promise<string[]> {
    try {
        const response = await axios.get(`${BYBIT_API_BASE}/instruments-info`, {
            params: {
                category: 'linear',
                limit: 1000
            }
        });

        if (response.data.retCode === 0 && response.data.result && response.data.result.list) {
            return response.data.result.list
                .filter((instrument: BybitInstrumentsInfo) => instrument.contractType === 'LinearPerpetual')
                .map((instrument: BybitInstrumentsInfo) => instrument.symbol);
        }
        return [];
    } catch (error) {
        console.error('Error fetching instruments info:', error);
        return [];
    }
}

async function fetchFundingRate(symbol: string): Promise<CoinFundingRate | null> {
    try {
        const response = await axios.get(`${BYBIT_API_BASE}/funding/history`, {
            params: {
                category: 'linear',
                symbol: symbol,
                limit: 1
            }
        });

        if (response.data.retCode === 0 && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
            const latestRate = response.data.result.list[0] as BybitFundingRate;
            return {
                symbol: latestRate.symbol,
                rate: parseFloat(latestRate.fundingRate),
                timestamp: parseInt(latestRate.fundingRateTimestamp)
            };
        }
        return null;
    } catch (error) {
        console.error(`Error fetching funding rate for ${symbol}:`, error);
        return null;
    }
}

// NEW: Fetch order book data
async function fetchOrderBook(symbol: string, limit: number = 50): Promise<OrderBookData | null> {
    try {
        const response = await axios.get(`${BYBIT_API_BASE}/orderbook`, {
            params: {
                category: 'linear',
                symbol: symbol,
                limit: limit
            }
        });

        if (response.data.retCode === 0 && response.data.result) {
            return {
                symbol: response.data.result.s,
                bids: response.data.result.b.map((level: string[]) => ({
                    price: level[0],
                    size: level[1]
                })),
                asks: response.data.result.a.map((level: string[]) => ({
                    price: level[0],
                    size: level[1]
                }))
            };
        }
        return null;
    } catch (error) {
        console.error(`Error fetching order book for ${symbol}:`, error);
        return null;
    }
}

// NEW: Calculate slippage based on order book
function calculateSlippage(
    orderBook: OrderBookData,
    tradeAmountUSDT: number,
    side: 'buy' | 'sell'
): SlippageAnalysis | null {
    const levels = side === 'buy' ? orderBook.asks : orderBook.bids;
    
    if (levels.length === 0) return null;

    const bestPrice = parseFloat(levels[0].price);
    let remainingUSDT = tradeAmountUSDT;
    let totalQuantityFilled = 0;
    let totalCostUSDT = 0;

    // Simulate filling the order through the order book
    for (const level of levels) {
        const price = parseFloat(level.price);
        const availableQuantity = parseFloat(level.size);
        const availableUSDT = availableQuantity * price;

        if (remainingUSDT <= 0) break;

        const quantityToFill = Math.min(remainingUSDT / price, availableQuantity);
        const costUSDT = quantityToFill * price;

        totalQuantityFilled += quantityToFill;
        totalCostUSDT += costUSDT;
        remainingUSDT -= costUSDT;
    }

    if (totalQuantityFilled === 0) return null;

    const avgPrice = totalCostUSDT / totalQuantityFilled;
    const slippagePercent = ((avgPrice - bestPrice) / bestPrice) * 100;
    const slippageUSDT = Math.abs(avgPrice - bestPrice) * totalQuantityFilled;
    const priceImpact = Math.abs(slippagePercent);

    return {
        avgPrice,
        bestPrice,
        slippagePercent,
        slippageUSDT,
        totalQuantity: totalQuantityFilled,
        priceImpact
    };
}

// NEW: Analyze trade with slippage
async function analyzeTradeSlippage(
    symbol: string, 
    tradeAmountUSDT: number, 
    side: 'buy' | 'sell'
): Promise<SlippageAnalysis | null> {
    console.log(`\n--- Slippage Analysis for ${symbol} ---`);
    console.log(`Order Type: ${side.toUpperCase()}`);
    console.log(`Trade Amount: $${tradeAmountUSDT.toFixed(2)}`);
    
    const orderBook = await fetchOrderBook(symbol, 200); // Get deeper book for accuracy
    
    if (!orderBook) {
        console.log('❌ Could not fetch order book');
        return null;
    }

    const slippage = calculateSlippage(orderBook, tradeAmountUSDT, side);
    
    if (!slippage) {
        console.log('❌ Could not calculate slippage (insufficient liquidity)');
        return null;
    }

    console.log(`\n📊 Results:`);
    console.log(`   Best Price: $${slippage.bestPrice.toFixed(8)}`);
    console.log(`   Avg Fill Price: $${slippage.avgPrice.toFixed(8)}`);
    console.log(`   Slippage: ${slippage.slippagePercent.toFixed(4)}% ($${slippage.slippageUSDT.toFixed(2)})`);
    console.log(`   Price Impact: ${slippage.priceImpact.toFixed(4)}%`);
    console.log(`   Total Quantity: ${slippage.totalQuantity.toFixed(4)}`);
    
    return slippage;
}

async function getFundingIntervalDetails(): Promise<{ nextFundingTime: Date | null, timeUntilNextFunding: string | null }> {
    const sampleSymbol = 'BTCUSDT';
    const rateInfo = await fetchFundingRate(sampleSymbol);

    if (rateInfo && rateInfo.timestamp) {
        const lastFundingTime = new Date(rateInfo.timestamp);
        const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

        let nextFundingTime = new Date(lastFundingTime.getTime() + FUNDING_INTERVAL_MS);
        const now = new Date();

        while (nextFundingTime.getTime() < now.getTime()) {
            nextFundingTime = new Date(nextFundingTime.getTime() + FUNDING_INTERVAL_MS);
        }

        const timeDiff = nextFundingTime.getTime() - now.getTime();

        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);

        const timeUntilNextFunding = `${hours}h ${minutes}m ${seconds}s`;
        return { nextFundingTime, timeUntilNextFunding };
    }
    return { nextFundingTime: null, timeUntilNextFunding: null };
}

async function getFundingRates(): Promise<{ positive: CoinFundingRate[]; negative: CoinFundingRate[] }> {
    const symbols = await fetchAllPerpetualSymbols();
    const fundingRates: CoinFundingRate[] = [];

    for (const symbol of symbols) {
        const rate = await fetchFundingRate(symbol);
        if (rate) {
            fundingRates.push(rate);
        }
    }

    const positiveRates = fundingRates
        .filter(coin => coin.rate > 0)
        .sort((a, b) => b.rate - a.rate);

    const negativeRates = fundingRates
        .filter(coin => coin.rate < 0)
        .sort((a, b) => a.rate - b.rate);

    return { positive: positiveRates, negative: negativeRates };
}

// NEW: Interactive slippage checker
async function interactiveSlippageCheck() {
    // In a real implementation, you'd get these from user input
    // For now, let's use example values
    
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('           INTERACTIVE SLIPPAGE ANALYZER');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Example: User wants to check slippage for a specific coin
    const selectedSymbol = 'DOGEUSDT'; // You can replace this with user input
    const tradeAmount = 160; // User specifies amount in USDT
    const side: 'buy' | 'sell' = 'buy'; // User specifies buy or sell
    
    console.log(`Selected Coin: ${selectedSymbol}`);
    console.log(`Trade Amount: $${tradeAmount}`);
    console.log(`Side: ${side.toUpperCase()}`);
    
    await analyzeTradeSlippage(selectedSymbol, tradeAmount, side);
}

async function init() {
    const TRADE_AMOUNT = 1000;

    console.log('Fetching funding rates...');
    try {
        const { nextFundingTime, timeUntilNextFunding } = await getFundingIntervalDetails();
        if (nextFundingTime && timeUntilNextFunding) {
            console.log(`\nNext Funding in: ${timeUntilNextFunding} (approx. at ${nextFundingTime.toUTCString()})`);
            console.log(`Note: Funding intervals can be dynamic and may adjust more frequently than 8 hours.`);
        }

        const { positive, negative } = await getFundingRates();

        console.log('\n--- Highest Positive Funding Rates (Net Profit/Loss for $1000 position) ---');
        positive.slice(0, 10).forEach(coin => { // Show top 10
            const fundingFee = coin.rate * TRADE_AMOUNT;
            const makerFee = TRADE_AMOUNT * MAKER_FEE_RATE;
            const netProfit = fundingFee - makerFee;
            console.log(`${coin.symbol}: Funding Rate = ${(coin.rate * 100).toFixed(4)}% | Net Profit (after 0.02% maker fee) = $${netProfit.toFixed(4)}`);
        });

        console.log('\n--- Highest Negative Funding Rates (Net Profit/Loss for $1000 position) ---');
        negative.slice(0, 10).forEach(coin => { // Show top 10
            const fundingFee = coin.rate * TRADE_AMOUNT;
            const makerFee = TRADE_AMOUNT * MAKER_FEE_RATE;
            const netProfit = fundingFee - makerFee;
            console.log(`${coin.symbol}: Funding Rate = ${(coin.rate * 100).toFixed(4)}% | Net Profit (after 0.02% maker fee) = $${netProfit.toFixed(4)}`);
        });

        // NEW: Run interactive slippage check
        await interactiveSlippageCheck();

        // NEW: Example - Analyze slippage for top negative funding rate coin
        if (negative.length > 0) {
            console.log('\n\n═══════════════════════════════════════════════════════');
            console.log('    ANALYZING TOP NEGATIVE FUNDING RATE OPPORTUNITY');
            console.log('═══════════════════════════════════════════════════════');
            
            const topCoin = negative[0];
            console.log(`\nTop Coin: ${topCoin.symbol}`);
            console.log(`Funding Rate: ${(topCoin.rate * 100).toFixed(4)}%`);
            
            // Analyze slippage for entering a long position (to earn negative funding)
            await analyzeTradeSlippage(topCoin.symbol, TRADE_AMOUNT, 'buy');
        }

    } catch (error) {
        console.error('Error during initialization:', error);
    }
}

init();
