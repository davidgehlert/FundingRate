"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const MAKER_FEE_RATE = 0.0002; // 0.02% as a default maker fee for perpetuals
const BYBIT_API_BASE = 'https://api.bybit.com/v5/market';
function fetchAllPerpetualSymbols() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get(`${BYBIT_API_BASE}/instruments-info`, {
                params: {
                    category: 'linear',
                    limit: 1000 // Adjust limit as needed, max 1000
                }
            });
            if (response.data.retCode === 0 && response.data.result && response.data.result.list) {
                return response.data.result.list
                    .filter((instrument) => instrument.contractType === 'LinearPerpetual') // Filter only for LinearPerpetual
                    .map((instrument) => instrument.symbol);
            }
            return [];
        }
        catch (error) {
            console.error('Error fetching instruments info:', error);
            return [];
        }
    });
}
function fetchFundingRate(symbol) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default.get(`${BYBIT_API_BASE}/funding/history`, {
                params: {
                    category: 'linear',
                    symbol: symbol,
                    limit: 1 // We only need the latest funding rate
                }
            });
            if (response.data.retCode === 0 && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
                const latestRate = response.data.result.list[0];
                return {
                    symbol: latestRate.symbol,
                    rate: parseFloat(latestRate.fundingRate),
                    timestamp: parseInt(latestRate.fundingRateTimestamp)
                };
            }
            return null;
        }
        catch (error) {
            console.error(`Error fetching funding rate for ${symbol}:`, error);
            return null;
        }
    });
}
function getFundingIntervalDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        // We need to fetch a funding rate for any symbol to get the latest timestamp
        const sampleSymbol = 'BTCUSDT'; // Or any other prominent symbol
        const rateInfo = yield fetchFundingRate(sampleSymbol);
        if (rateInfo && rateInfo.timestamp) {
            const lastFundingTime = new Date(rateInfo.timestamp);
            // Bybit typically has 8-hour funding intervals (in milliseconds)
            const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
            let nextFundingTime = new Date(lastFundingTime.getTime() + FUNDING_INTERVAL_MS);
            const now = new Date();
            // If the calculated next funding time is in the past, keep adding intervals until it's in the future
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
    });
}
function getFundingRates() {
    return __awaiter(this, void 0, void 0, function* () {
        const symbols = yield fetchAllPerpetualSymbols();
        const fundingRates = [];
        for (const symbol of symbols) {
            const rate = yield fetchFundingRate(symbol);
            if (rate) {
                fundingRates.push(rate);
            }
        }
        const positiveRates = fundingRates
            .filter(coin => coin.rate > 0)
            .sort((a, b) => b.rate - a.rate); // Descending
        const negativeRates = fundingRates
            .filter(coin => coin.rate < 0)
            .sort((a, b) => a.rate - b.rate); // Ascending
        return { positive: positiveRates, negative: negativeRates };
    });
}
function init() {
    return __awaiter(this, void 0, void 0, function* () {
        const TRADE_AMOUNT = 1000; // Example trade amount in USDT
        console.log('Fetching funding rates...');
        try {
            const { nextFundingTime, timeUntilNextFunding } = yield getFundingIntervalDetails();
            if (nextFundingTime && timeUntilNextFunding) {
                console.log(`\nNext Funding in: ${timeUntilNextFunding} (approx. at ${nextFundingTime.toUTCString()})`);
                console.log(`Note: Funding intervals can be dynamic and may adjust more frequently than 8 hours.`);
            }
            const { positive, negative } = yield getFundingRates();
            console.log('\n--- Highest Positive Funding Rates (Net Profit/Loss for $1000 position) ---');
            positive.forEach(coin => {
                const fundingFee = coin.rate * TRADE_AMOUNT;
                const makerFee = TRADE_AMOUNT * MAKER_FEE_RATE;
                const netProfit = fundingFee - makerFee;
                console.log(`${coin.symbol}: Funding Rate = ${(coin.rate * 100).toFixed(4)}% | Net Profit (after 0.02% maker fee) = $${netProfit.toFixed(4)}`);
            });
            console.log('\n--- Highest Negative Funding Rates (Net Profit/Loss for $1000 position) ---');
            negative.forEach(coin => {
                const fundingFee = coin.rate * TRADE_AMOUNT; // Negative value
                const makerFee = TRADE_AMOUNT * MAKER_FEE_RATE;
                const netProfit = fundingFee - makerFee; // More negative
                console.log(`${coin.symbol}: Funding Rate = ${(coin.rate * 100).toFixed(4)}% | Net Profit (after 0.02% maker fee) = $${netProfit.toFixed(4)}`);
            });
        }
        catch (error) {
            console.error('Error during initialization:', error);
        }
    });
}
init();
