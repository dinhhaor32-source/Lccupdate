const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
const Fastify = require("fastify");
const WebSocket = require("ws");
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const fastifyWebsocket = require('@fastify/websocket');
const axios = require('axios'); // <<< THƯ VIỆN MỚI ĐỂ GỌI API

const fastify = Fastify({ logger: true });
const PORT = process.env.PORT || 3000;

fastify.register(fastifyWebsocket);

// --- Cấu hình API Key và Auth cho WebSocket Server của bạn ---
const API_KEY = "tuankietdevtool";

fastify.addHook("onRequest", async (request, reply) => {
  if (request.url.startsWith("/api/sunwin") || request.url.startsWith("/api/history-json")) {
    const urlKey = request.query.key;
    if (!urlKey || urlKey !== API_KEY) {
      return reply.code(403).send({ error: "Key sai mẹ rồi, liên hệ tele: @hellokietne21" });
    }
  }
});

const authenticateWebSocket = (id, key) => {
  return key === API_KEY;
};

// --- Biến toàn cục cho Polling API ---
const HISTORY_API_URL = "https://lc79txmd5-production-4966.up.railway.app/history";
let latestFetchedSessionId = 0;
const POLLING_INTERVAL = 5000;
let isPolling = false;

// --- Khởi tạo cơ sở dữ liệu SQLite ---
const dbPath = path.resolve(__dirname, 'sun.sql');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Lỗi kết nối cơ sở dữ liệu:", err.message);
  } else {
    console.log("Đã kết nối cơ sở dữ liệu SQLite.");
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid INTEGER PRIMARY KEY,
        d1 INTEGER NOT NULL,
        d2 INTEGER NOT NULL,
        d3 INTEGER NOT NULL,
        total INTEGER NOT NULL,
        result TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error("Lỗi tạo bảng 'sessions':", err.message);
      } else {
        console.log("Bảng 'sessions' đã sẵn sàng.");
      }
    });
  }
});

// --- Cấu hình file log cầu và hiệu suất logic ---
const cauLogFilePath = path.resolve(__dirname, 'cauapisun_log.jsonl');
const logicPerformanceFilePath = path.resolve(__dirname, 'logic_performance.json');

// --- Đối tượng lưu hiệu suất của từng logic (giữ nguyên như cũ) ---
let logicPerformance = {
  logic1: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic2: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic3: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic4: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic5: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic6: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic7: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic8: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic9: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic10: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic11: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic12: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic13: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic14: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic15: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic16: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic17: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic18: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic19: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic20: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic21: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic22: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic23: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
  logic24: { correct: 0, total: 0, accuracy: 0, consistency: 0, lastPredicted: null, lastActual: null },
};

const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const MODERATE_CONFIDENCE_THRESHOLD = 0.60;

// ==================== CÁC HÀM HELPER VÀ LOGIC ====================
async function saveLogicPerformance() {
  try {
    await fs.promises.writeFile(logicPerformanceFilePath, JSON.stringify(logicPerformance, null, 2), 'utf8');
    console.log("Logic performance saved to logic_performance.json");
  } catch (err) {
    console.error("Error saving logic performance:", err);
  }
}

async function loadLogicPerformance() {
  try {
    const data = await fs.promises.readFile(logicPerformanceFilePath, 'utf8');
    const loadedPerformance = JSON.parse(data);
    for (const key in logicPerformance) {
      if (loadedPerformance[key]) {
        Object.assign(logicPerformance[key], loadedPerformance[key]);
      }
    }
    console.log("Logic performance loaded from logic_performance.json");
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log("logic_performance.json not found. Initializing with default values.");
    } else {
      console.error("Error loading logic performance:", err);
    }
  }
}

function updateLogicPerformance(logicName, predicted, actual) {
  if (predicted === null || !logicPerformance[logicName]) return;

  const currentAcc = logicPerformance[logicName].accuracy;
  const currentTotal = logicPerformance[logicName].total;

  let dynamicDecayFactor = 0.95;
  if (currentTotal > 0 && currentAcc < 0.60) {
    dynamicDecayFactor = 0.85;
  } else if (currentTotal > 0 && currentAcc > 0.80) {
    dynamicDecayFactor = 0.98;
  }

  logicPerformance[logicName].correct = logicPerformance[logicName].correct * dynamicDecayFactor;
  logicPerformance[logicName].total = logicPerformance[logicName].total * dynamicDecayFactor;

  logicPerformance[logicName].total++;
  let wasCorrect = 0;
  if (predicted === actual) {
    logicPerformance[logicName].correct++;
    wasCorrect = 1;
  }

  logicPerformance[logicName].accuracy = logicPerformance[logicName].total > 0 ?
    (logicPerformance[logicName].correct / logicPerformance[logicName].total) : 0;

  const adaptiveAlphaConsistency = (currentAcc < 0.6) ? 0.3 : 0.1;
  logicPerformance[logicName].consistency = (logicPerformance[logicName].consistency * (1 - adaptiveAlphaConsistency)) + (wasCorrect * adaptiveAlphaConsistency);

  if (logicPerformance[logicName].total < 20 && logicPerformance[logicName].accuracy > 0.90) {
    logicPerformance[logicName].accuracy = 0.90;
  } else if (logicPerformance[logicName].total < 50 && logicPerformance[logicName].accuracy > 0.95) {
    logicPerformance[logicName].accuracy = 0.95;
  }

  logicPerformance[logicName].lastPredicted = predicted;
  logicPerformance[logicName].lastActual = actual;
}

function calculateStdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function getDiceFrequencies(history, limit) {
  const allDice = [];
  const effectiveHistory = history.slice(0, limit);
  effectiveHistory.forEach(s => {
    allDice.push(s.d1, s.d2, s.d3);
  });
  const diceFreq = new Array(7).fill(0);
  allDice.forEach(d => {
    if (d >= 1 && d <= 6) diceFreq[d]++;
  });
  return diceFreq;
}

function logCauPattern(patternData) {
  fs.appendFile(cauLogFilePath, JSON.stringify(patternData) + '\n', (err) => {
    if (err) console.error("Lỗi khi ghi log cầu:", err);
  });
}

async function readCauLog() {
  return new Promise((resolve) => {
    fs.readFile(cauLogFilePath, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') return resolve([]);
        console.error("Lỗi khi đọc log cầu:", err);
        return resolve([]);
      }
      try {
        const lines = data.split('\n').filter(line => line.trim() !== '');
        const patterns = lines.map(line => JSON.parse(line));
        resolve(patterns);
      } catch (e) {
        console.error("Lỗi phân tích cú pháp log cầu:", e);
        resolve([]);
      }
    });
  });
}

const connectedClients = new Set();

// ==================== CÁC HÀM DỰ ĐOÁN (GIỮ NGUYÊN TOÀN BỘ) ====================
function predictLogic1(lastSession, history) {
  if (!lastSession || history.length < 10) return null;
  const lastDigitOfSession = lastSession.sid % 10;
  const totalPreviousSession = lastSession.total;
  let indicatorSum = lastDigitOfSession + totalPreviousSession;
  const currentPrediction = indicatorSum % 2 === 0 ? "Xỉu" : "Tài";
  let correctCount = 0;
  let totalCount = 0;
  const consistencyWindow = Math.min(history.length - 1, 25);
  for (let i = 0; i < consistencyWindow; i++) {
    const session = history[i];
    const prevSession = history[i + 1];
    if (prevSession) {
      const prevIndicatorSum = (prevSession.sid % 10) + prevSession.total;
      const prevPredicted = prevIndicatorSum % 2 === 0 ? "Xỉu" : "Tài";
      if (prevPredicted === session.result) {
        correctCount++;
      }
      totalCount++;
    }
  }
  if (totalCount > 5 && (correctCount / totalCount) >= 0.65) {
    return currentPrediction;
  }
  return null;
}

function predictLogic2(nextSessionId, history) {
  if (history.length < 15) return null;
  let thuanScore = 0;
  let nghichScore = 0;
  const analysisWindow = Math.min(history.length, 60);
  for (let i = 0; i < analysisWindow; i++) {
    const session = history[i];
    const isEvenSID = session.sid % 2 === 0;
    const weight = 1.0 - (i / analysisWindow) * 0.6;
    if ((isEvenSID && session.result === "Xỉu") || (!isEvenSID && session.result === "Tài")) {
      thuanScore += weight;
    }
    if ((isEvenSID && session.result === "Tài") || (!isEvenSID && session.result === "Xỉu")) {
      nghichScore += weight;
    }
  }
  const currentSessionIsEven = nextSessionId % 2 === 0;
  const totalScore = thuanScore + nghichScore;
  if (totalScore < 10) return null;
  const thuanRatio = thuanScore / totalScore;
  const nghichRatio = nghichScore / totalScore;
  if (thuanRatio > nghichRatio + 0.15) {
    return currentSessionIsEven ? "Xỉu" : "Tài";
  } else if (nghichRatio > thuanRatio + 0.15) {
    return currentSessionIsEven ? "Tài" : "Xỉu";
  }
  return null;
}

function predictLogic3(history) {
  if (history.length < 15) return null;
  const analysisWindow = Math.min(history.length, 50);
  const lastXTotals = history.slice(0, analysisWindow).map(s => s.total);
  const sumOfTotals = lastXTotals.reduce((a, b) => a + b, 0);
  const average = sumOfTotals / analysisWindow;
  const stdDev = calculateStdDev(lastXTotals);
  const deviationFactor = 0.8;
  const recentTrendLength = Math.min(5, history.length);
  const recentTrend = history.slice(0, recentTrendLength).map(s => s.total);
  let isRising = false;
  let isFalling = false;
  if (recentTrendLength >= 3) {
    isRising = true;
    isFalling = true;
    for (let i = 0; i < recentTrendLength - 1; i++) {
      if (recentTrend[i] <= recentTrend[i + 1]) isRising = false;
      if (recentTrend[i] >= recentTrend[i + 1]) isFalling = false;
    }
  }
  if (average < 10.5 - (deviationFactor * stdDev) && isFalling) {
    return "Xỉu";
  } else if (average > 10.5 + (deviationFactor * stdDev) && isRising) {
    return "Tài";
  }
  return null;
}

function predictLogic4(history) {
  if (history.length < 30) return null;
  let bestPrediction = null;
  let maxConfidence = 0;
  const volatility = calculateStdDev(history.slice(0, Math.min(30, history.length)).map(s => s.total));
  const patternLengths = (volatility < 1.7) ? [6, 5, 4] : [5, 4, 3];
  for (const len of patternLengths) {
    if (history.length < len + 2) continue;
    const recentPattern = history.slice(0, len).map(s => s.result).reverse().join('');
    let taiFollows = 0;
    let xiuFollows = 0;
    let totalMatches = 0;
    for (let i = len; i < Math.min(history.length - 1, 200); i++) {
      const patternToMatch = history.slice(i, i + len).map(s => s.result).reverse().join('');
      if (patternToMatch === recentPattern) {
        totalMatches++;
        const nextResult = history[i - 1].result;
        if (nextResult === 'Tài') {
          taiFollows++;
        } else {
          xiuFollows++;
        }
      }
    }
    if (totalMatches < 3) continue;
    const taiConfidence = taiFollows / totalMatches;
    const xiuConfidence = xiuFollows / totalMatches;
    const MIN_PATTERN_CONFIDENCE = 0.70;
    if (taiConfidence >= MIN_PATTERN_CONFIDENCE && taiConfidence > maxConfidence) {
      maxConfidence = taiConfidence;
      bestPrediction = "Tài";
    } else if (xiuConfidence >= MIN_PATTERN_CONFIDENCE && xiuConfidence > maxConfidence) {
      maxConfidence = xiuConfidence;
      bestPrediction = "Xỉu";
    }
  }
  return bestPrediction;
}

function predictLogic5(history) {
  if (history.length < 40) return null;
  const sumCounts = {};
  const analysisWindow = Math.min(history.length, 400);
  for (let i = 0; i < analysisWindow; i++) {
    const total = history[i].total;
    const weight = 1.0 - (i / analysisWindow) * 0.8;
    sumCounts[total] = (sumCounts[total] || 0) + weight;
  }
  let mostFrequentSum = -1;
  let maxWeightedCount = 0;
  for (const sum in sumCounts) {
    if (sumCounts[sum] > maxWeightedCount) {
      maxWeightedCount = sumCounts[sum];
      mostFrequentSum = parseInt(sum);
    }
  }
  if (mostFrequentSum !== -1) {
    const minWeightedCountRatio = 0.08;
    const totalWeightedSum = Object.values(sumCounts).reduce((a, b) => a + b, 0);
    if (totalWeightedSum > 0 && (maxWeightedCount / totalWeightedSum) > minWeightedCountRatio) {
      const neighbors = [];
      if (sumCounts[mostFrequentSum - 1]) neighbors.push(sumCounts[mostFrequentSum - 1]);
      if (sumCounts[mostFrequentSum + 1]) neighbors.push(sumCounts[mostFrequentSum + 1]);
      const isPeak = neighbors.every(n => maxWeightedCount > n * 1.05);
      if (isPeak) {
        if (mostFrequentSum <= 10) return "Xỉu";
        if (mostFrequentSum >= 11) return "Tài";
      }
    }
  }
  return null;
}

function predictLogic6(lastSession, history) {
  if (!lastSession || history.length < 40) return null;
  const nextSessionLastDigit = (lastSession.sid + 1) % 10;
  const lastSessionTotalParity = lastSession.total % 2;
  let taiVotes = 0;
  let xiuVotes = 0;
  const analysisWindow = Math.min(history.length, 250);
  if (analysisWindow < 2) return null;
  for (let i = 0; i < analysisWindow - 1; i++) {
    const currentHistSessionResult = history[i].result;
    const prevHistSession = history[i + 1];
    const prevSessionLastDigit = prevHistSession.sid % 10;
    const prevSessionTotalParity = prevHistSession.total % 2;
    const featureSetHistory = `${prevSessionLastDigit % 2}-${prevSessionTotalParity}-${(prevHistSession.total > 10.5 ? 'T' : 'X')}`;
    const featureSetCurrent = `${nextSessionLastDigit % 2}-${lastSessionTotalParity}-${(lastSession.total > 10.5 ? 'T' : 'X')}`;
    if (featureSetHistory === featureSetCurrent) {
      if (currentHistSessionResult === "Tài") {
        taiVotes++;
      } else {
        xiuVotes++;
      }
    }
  }
  const totalVotes = taiVotes + xiuVotes;
  if (totalVotes < 5) return null;
  const voteDifferenceRatio = Math.abs(taiVotes - xiuVotes) / totalVotes;
  if (voteDifferenceRatio > 0.25) {
    if (taiVotes > xiuVotes) return "Tài";
    if (xiuVotes > taiVotes) return "Xỉu";
  }
  return null;
}

function predictLogic7(history) {
  const TREND_STREAK_LENGTH_MIN = 4;
  const TREND_STREAK_LENGTH_MAX = 7;
  if (history.length < TREND_STREAK_LENGTH_MIN) return null;
  const volatility = calculateStdDev(history.slice(0, Math.min(25, history.length)).map(s => s.total));
  const effectiveStreakLength = (volatility < 1.6) ? TREND_STREAK_LENGTH_MAX : TREND_STREAK_LENGTH_MIN + 1;
  const recentResults = history.slice(0, effectiveStreakLength).map(s => s.result);
  if (recentResults.length < effectiveStreakLength) return null;
  if (recentResults.every(r => r === "Tài")) {
    const nextFew = history.slice(effectiveStreakLength, effectiveStreakLength + 2);
    if (nextFew.length === 2 && nextFew.filter(s => s.result === "Tài").length >= 1) {
      return "Tài";
    }
  }
  if (recentResults.every(r => r === "Xỉu")) {
    const nextFew = history.slice(effectiveStreakLength, effectiveStreakLength + 2);
    if (nextFew.length === 2 && nextFew.filter(s => s.result === "Xỉu").length >= 1) {
      return "Xỉu";
    }
  }
  return null;
}

function predictLogic8(history) {
  const LONG_PERIOD = 30;
  if (history.length < LONG_PERIOD + 1) return null;
  const calculateAverage = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const longTermTotals = history.slice(1, LONG_PERIOD + 1).map(s => s.total);
  const longTermAverage = calculateAverage(longTermTotals);
  const longTermStdDev = calculateStdDev(longTermTotals);
  const lastSessionTotal = history[0].total;
  const dynamicDeviationThreshold = Math.max(1.5, 0.8 * longTermStdDev);
  const last5Totals = history.slice(0, Math.min(5, history.length)).map(s => s.total);
  let isLast5Rising = false;
  let isLast5Falling = false;
  if (last5Totals.length >= 2) {
    isLast5Rising = true;
    isLast5Falling = true;
    for (let i = 0; i < last5Totals.length - 1; i++) {
      if (last5Totals[i] <= last5Totals[i + 1]) isLast5Rising = false;
      if (last5Totals[i] >= last5Totals[i + 1]) isLast5Falling = false;
    }
  }
  if (lastSessionTotal > longTermAverage + dynamicDeviationThreshold && isLast5Rising) {
    return "Xỉu";
  }
  else if (lastSessionTotal < longTermAverage - dynamicDeviationThreshold && isLast5Falling) {
    return "Tài";
  }
  return null;
}

function predictLogic9(history) {
  if (history.length < 20) return null;
  let maxTaiStreak = 0;
  let maxXiuStreak = 0;
  let currentTaiStreakForHistory = 0;
  let currentXiuStreakForHistory = 0;
  const historyForMaxStreak = history.slice(0, Math.min(history.length, 120));
  for (const session of historyForMaxStreak) {
    if (session.result === "Tài") {
      currentTaiStreakForHistory++;
      currentXiuStreakForHistory = 0;
    } else {
      currentXiuStreakForHistory++;
      currentTaiStreakForHistory = 0;
    }
    maxTaiStreak = Math.max(maxTaiStreak, currentTaiStreakForHistory);
    maxXiuStreak = Math.max(maxXiuStreak, currentXiuStreakForHistory);
  }
  const dynamicThreshold = Math.max(4, Math.floor(Math.max(maxTaiStreak, maxXiuStreak) * 0.5));
  const mostRecentResult = history[0].result;
  let currentConsecutiveCount = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].result === mostRecentResult) {
      currentConsecutiveCount++;
    } else {
      break;
    }
  }
  if (currentConsecutiveCount >= dynamicThreshold) {
    if (currentConsecutiveCount >= 3) {
      let totalReversals = 0;
      let totalContinuations = 0;
      for (let i = currentConsecutiveCount; i < history.length - currentConsecutiveCount; i++) {
        const potentialStreak = history.slice(i, i + currentConsecutiveCount);
        if (potentialStreak.every(s => s.result === mostRecentResult)) {
          if (history[i - 1] && history[i - 1].result !== mostRecentResult) {
            totalReversals++;
          } else if (history[i - 1] && history[i - 1].result === mostRecentResult) {
            totalContinuations++;
          }
        }
      }
      if (totalReversals + totalContinuations > 3 && totalReversals > totalContinuations * 1.3) {
        return mostRecentResult === "Tài" ? "Xỉu" : "Tài";
      }
    }
  }
  return null;
}

function predictLogic10(history) {
  const MOMENTUM_STREAK_LENGTH = 3;
  const STABILITY_CHECK_LENGTH = 7;
  if (history.length < STABILITY_CHECK_LENGTH + 1) return null;
  const recentResults = history.slice(0, MOMENTUM_STREAK_LENGTH).map(s => s.result);
  const widerHistory = history.slice(0, STABILITY_CHECK_LENGTH).map(s => s.result);
  if (recentResults.every(r => r === "Tài")) {
    const taiCountInWider = widerHistory.filter(r => r === "Tài").length;
    if (taiCountInWider / STABILITY_CHECK_LENGTH >= 0.75) {
      if (predictLogic9(history) !== "Xỉu") {
        return "Tài";
      }
    }
  }
  if (recentResults.every(r => r === "Xỉu")) {
    const xiuCountInWider = widerHistory.filter(r => r === "Xỉu").length;
    if (xiuCountInWider / STABILITY_CHECK_LENGTH >= 0.75) {
      if (predictLogic9(history) !== "Tài") {
        return "Xỉu";
      }
    }
  }
  return null;
}

function predictLogic11(history) {
  if (history.length < 15) return null;
  const reversalPatterns = [
    { pattern: "TàiXỉuTài", predict: "Xỉu", minOccurrences: 3, weight: 1.5 },
    { pattern: "XỉuTàiXỉu", predict: "Tài", minOccurrences: 3, weight: 1.5 },
    { pattern: "TàiTàiXỉu", predict: "Tài", minOccurrences: 4, weight: 1.3 },
    { pattern: "XỉuXỉuTài", predict: "Xỉu", minOccurrences: 4, weight: 1.3 },
    { pattern: "TàiXỉuXỉu", predict: "Tài", minOccurrences: 3, weight: 1.4 },
    { pattern: "XỉuTàiTài", predict: "Xỉu", minOccurrences: 3, weight: 1.4 },
    { pattern: "XỉuTàiTàiXỉu", predict: "Xỉu", minOccurrences: 2, weight: 1.6 },
    { pattern: "TàiXỉuXỉuTài", predict: "Tài", minOccurrences: 2, weight: 1.6 },
    { pattern: "TàiXỉuTàiXỉu", predict: "Tài", minOccurrences: 2, weight: 1.4 },
    { pattern: "XỉuTàiXỉuTài", predict: "Xỉu", minOccurrences: 2, weight: 1.4 },
    { pattern: "TàiXỉuXỉuXỉu", predict: "Tài", minOccurrences: 1, weight: 1.7 },
    { pattern: "XỉuTàiTàiTài", predict: "Xỉu", minOccurrences: 1, weight: 1.7 },
  ];
  let bestPatternMatch = null;
  let maxWeightedConfidence = 0;
  for (const patternDef of reversalPatterns) {
    const patternDefShort = patternDef.pattern.replace(/Tài/g, 'T').replace(/Xỉu/g, 'X');
    const patternLength = patternDefShort.length;
    if (history.length < patternLength + 1) continue;
    const currentWindowShort = history.slice(0, patternLength).map(s => s.result === 'Tài' ? 'T' : 'X').reverse().join('');
    if (currentWindowShort === patternDefShort) {
      let matchCount = 0;
      let totalPatternOccurrences = 0;
      for (let i = patternLength; i < Math.min(history.length - 1, 350); i++) {
        const historicalPatternShort = history.slice(i, i + patternLength).map(s => s.result === 'Tài' ? 'T' : 'X').reverse().join('');
        if (historicalPatternShort === patternDefShort) {
          totalPatternOccurrences++;
          if (history[i - 1].result === patternDef.predict) {
            matchCount++;
          }
        }
      }
      if (totalPatternOccurrences < patternDef.minOccurrences) continue;
      const patternAccuracy = matchCount / totalPatternOccurrences;
      if (patternAccuracy >= 0.68) {
        const weightedConfidence = patternAccuracy * patternDef.weight;
        if (weightedConfidence > maxWeightedConfidence) {
          maxWeightedConfidence = weightedConfidence;
          bestPatternMatch = patternDef.predict;
        }
      }
    }
  }
  return bestPatternMatch;
}

function predictLogic12(lastSession, history) {
  if (!lastSession || history.length < 20) return null;
  const nextSessionParity = (lastSession.sid + 1) % 2;
  const mostRecentResult = history[0].result;
  let currentConsecutiveCount = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].result === mostRecentResult) {
      currentConsecutiveCount++;
    } else {
      break;
    }
  }
  let taiVotes = 0;
  let xiuVotes = 0;
  const analysisWindow = Math.min(history.length, 250);
  for (let i = 0; i < analysisWindow - 1; i++) {
    const currentHistSession = history[i];
    const prevHistSession = history[i + 1];
    const prevHistSessionParity = prevHistSession.sid % 2;
    let histConsecutiveCount = 0;
    for (let j = i + 1; j < analysisWindow; j++) {
      if (history[j].result === prevHistSession.result) {
        histConsecutiveCount++;
      } else {
        break;
      }
    }
    if (prevHistSessionParity === nextSessionParity && histConsecutiveCount === currentConsecutiveCount) {
      if (currentHistSession.result === "Tài") {
        taiVotes++;
      } else {
        xiuVotes++;
      }
    }
  }
  const totalVotes = taiVotes + xiuVotes;
  if (totalVotes < 6) return null;
  if (taiVotes / totalVotes >= 0.68) return "Tài";
  if (xiuVotes / totalVotes >= 0.68) return "Xỉu";
  return null;
}

function predictLogic13(history) {
  if (history.length < 80) return null;
  const mostRecentResult = history[0].result;
  let currentStreakLength = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].result === mostRecentResult) {
      currentStreakLength++;
    } else {
      break;
    }
  }
  if (currentStreakLength < 1) return null;
  const streakStats = {};
  const analysisWindow = Math.min(history.length, 500);
  for (let i = 0; i < analysisWindow - 1; i++) {
    const sessionResult = history[i].result;
    const prevSessionResult = history[i + 1].result;
    let tempStreakLength = 1;
    for (let j = i + 2; j < analysisWindow; j++) {
      if (history[j].result === prevSessionResult) {
        tempStreakLength++;
      } else {
        break;
      }
    }
    if (tempStreakLength > 0) {
      const streakKey = `${prevSessionResult}_${tempStreakLength}`;
      if (!streakStats[streakKey]) {
        streakStats[streakKey] = { 'Tài': 0, 'Xỉu': 0 };
      }
      streakStats[streakKey][sessionResult]++;
    }
  }
  const currentStreakKey = `${mostRecentResult}_${currentStreakLength}`;
  if (streakStats[currentStreakKey]) {
    const stats = streakStats[currentStreakKey];
    const totalFollowUps = stats['Tài'] + stats['Xỉu'];
    if (totalFollowUps < 5) return null;
    const taiProb = stats['Tài'] / totalFollowUps;
    const xiuProb = stats['Xỉu'] / totalFollowUps;
    const CONFIDENCE_THRESHOLD = 0.65;
    if (taiProb >= CONFIDENCE_THRESHOLD) {
      return "Tài";
    } else if (xiuProb >= CONFIDENCE_THRESHOLD) {
      return "Xỉu";
    }
  }
  return null;
}

function predictLogic14(history) {
  if (history.length < 50) return null;
  const shortPeriod = 8;
  const longPeriod = 30;
  if (history.length < longPeriod) return null;
  const shortTermTotals = history.slice(0, shortPeriod).map(s => s.total);
  const longTermTotals = history.slice(0, longPeriod).map(s => s.total);
  const shortAvg = shortTermTotals.reduce((a, b) => a + b, 0) / shortPeriod;
  const longAvg = longTermTotals.reduce((a, b) => a + b, 0) / longPeriod;
  const longStdDev = calculateStdDev(longTermTotals);
  if (shortAvg > longAvg + (longStdDev * 0.8)) {
    const last2Results = history.slice(0, 2).map(s => s.result);
    if (last2Results.length === 2 && last2Results.every(r => r === "Tài")) {
      return "Xỉu";
    }
  }
  else if (shortAvg < longAvg - (longStdDev * 0.8)) {
    const last2Results = history.slice(0, 2).map(s => s.result);
    if (last2Results.length === 2 && last2Results.every(r => r === "Xỉu")) {
      return "Tài";
    }
  }
  return null;
}

function predictLogic15(history) {
  if (history.length < 80) return null;
  const analysisWindow = Math.min(history.length, 400);
  const evenCounts = { "Tài": 0, "Xỉu": 0 };
  const oddCounts = { "Tài": 0, "Xỉu": 0 };
  let totalEven = 0;
  let totalOdd = 0;
  for (let i = 0; i < analysisWindow; i++) {
    const session = history[i];
    const isTotalEven = session.total % 2 === 0;
    if (isTotalEven) {
      evenCounts[session.result]++;
      totalEven++;
    } else {
      oddCounts[session.result]++;
      totalOdd++;
    }
  }
  if (totalEven < 20 || totalOdd < 20) return null;
  const lastSessionTotal = history[0].total;
  const isLastTotalEven = lastSessionTotal % 2 === 0;
  const minDominance = 0.65;
  if (isLastTotalEven) {
    if (evenCounts["Tài"] / totalEven >= minDominance) return "Tài";
    if (evenCounts["Xỉu"] / totalEven >= minDominance) return "Xỉu";
  } else {
    if (oddCounts["Tài"] / totalOdd >= minDominance) return "Tài";
    if (oddCounts["Xỉu"] / totalOdd >= minDominance) return "Xỉu";
  }
  return null;
}

function predictLogic16(history) {
  if (history.length < 60) return null;
  const MODULO_N = 5;
  const analysisWindow = Math.min(history.length, 500);
  const moduloPatterns = {};
  for (let i = 0; i < analysisWindow - 1; i++) {
    const prevSession = history[i + 1];
    const currentSessionResult = history[i].result;
    const moduloValue = prevSession.total % MODULO_N;
    if (!moduloPatterns[moduloValue]) {
      moduloPatterns[moduloValue] = { 'Tài': 0, 'Xỉu': 0 };
    }
    moduloPatterns[moduloValue][currentSessionResult]++;
  }
  const lastSessionTotal = history[0].total;
  const currentModuloValue = lastSessionTotal % MODULO_N;
  if (moduloPatterns[currentModuloValue]) {
    const stats = moduloPatterns[currentModuloValue];
    const totalCount = stats['Tài'] + stats['Xỉu'];
    if (totalCount < 7) return null;
    const taiProb = stats['Tài'] / totalCount;
    const xiuProb = stats['Xỉu'] / totalCount;
    const CONFIDENCE_THRESHOLD = 0.65;
    if (taiProb >= CONFIDENCE_THRESHOLD) {
      return "Tài";
    } else if (xiuProb >= CONFIDENCE_THRESHOLD) {
      return "Xỉu";
    }
  }
  return null;
}

function predictLogic17(history) {
  if (history.length < 100) return null;
  const analysisWindow = Math.min(history.length, 600);
  const totals = history.slice(0, analysisWindow).map(s => s.total);
  const meanTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  const stdDevTotal = calculateStdDev(totals);
  const lastSessionTotal = history[0].total;
  const deviation = Math.abs(lastSessionTotal - meanTotal);
  const zScore = stdDevTotal > 0 ? deviation / stdDevTotal : 0;
  const Z_SCORE_THRESHOLD = 1.5;
  if (zScore >= Z_SCORE_THRESHOLD) {
    if (lastSessionTotal > meanTotal) {
      return "Xỉu";
    } else {
      return "Tài";
    }
  }
  return null;
}

function predictLogic18(history) {
  if (history.length < 50) return null;
  const analysisWindow = Math.min(history.length, 300);
  const patternStats = {};
  for (let i = 0; i < analysisWindow - 1; i++) {
    const prevSession = history[i + 1];
    const currentSessionResult = history[i].result;
    const p1 = prevSession.d1 % 2;
    const p2 = prevSession.d2 % 2;
    const p3 = prevSession.d3 % 2;
    const patternKey = `${p1}-${p2}-${p3}`;
    if (!patternStats[patternKey]) {
      patternStats[patternKey] = { 'Tài': 0, 'Xỉu': 0 };
    }
    patternStats[patternKey][currentSessionResult]++;
  }
  const lastSession = history[0];
  const currentP1 = lastSession.d1 % 2;
  const currentP2 = lastSession.d2 % 2;
  const currentP3 = lastSession.d3 % 2;
  const currentPatternKey = `${currentP1}-${currentP2}-${currentP3}`;
  if (patternStats[currentPatternKey]) {
    const stats = patternStats[currentPatternKey];
    const totalCount = stats['Tài'] + stats['Xỉu'];
    if (totalCount < 8) return null;
    const taiProb = stats['Tài'] / totalCount;
    const xiuProb = stats['Xỉu'] / totalCount;
    const CONFIDENCE_THRESHOLD = 0.65;
    if (taiProb >= CONFIDENCE_THRESHOLD) {
      return "Tài";
    } else if (xiuProb >= CONFIDENCE_THRESHOLD) {
      return "Xỉu";
    }
  }
  return null;
}

function predictLogic19(history) {
  if (history.length < 50) return null;
  let taiScore = 0;
  let xiuScore = 0;
  const now = new Date().getTime();
  const analysisWindowMs = 2 * 60 * 60 * 1000;
  for (const session of history) {
    if (now - session.timestamp > analysisWindowMs) break;
    const ageFactor = 1 - ((now - session.timestamp) / analysisWindowMs);
    const weight = ageFactor * ageFactor * ageFactor;
    if (session.result === "Tài") {
      taiScore += weight;
    } else {
      xiuScore += weight;
    }
  }
  const totalScore = taiScore + xiuScore;
  if (totalScore < 10) return null;
  const taiRatio = taiScore / totalScore;
  const xiuRatio = xiuScore / totalScore;
  const BIAS_THRESHOLD = 0.10;
  if (taiRatio > xiuRatio + BIAS_THRESHOLD) {
    return "Tài";
  } else if (xiuRatio > taiRatio + BIAS_THRESHOLD) {
    return "Xỉu";
  }
  return null;
}

function markovWeightedV3(patternArr) {
  if (patternArr.length < 3) return null;
  const transitions = {};
  const lastResult = patternArr[patternArr.length - 1];
  const secondLastResult = patternArr.length > 1 ? patternArr[patternArr.length - 2] : null;
  for (let i = 0; i < patternArr.length - 1; i++) {
    const current = patternArr[i];
    const next = patternArr[i + 1];
    const key = current + next;
    if (!transitions[key]) {
      transitions[key] = { 'T': 0, 'X': 0 };
    }
    if (i + 2 < patternArr.length) {
      transitions[key][patternArr[i + 2]]++;
    }
  }
  if (secondLastResult && lastResult) {
    const currentTransitionKey = secondLastResult + lastResult;
    if (transitions[currentTransitionKey]) {
      const stats = transitions[currentTransitionKey];
      const total = stats['T'] + stats['X'];
      if (total > 3) {
        if (stats['T'] / total > 0.60) return "Tài";
        if (stats['X'] / total > 0.60) return "Xỉu";
      }
    }
  }
  return null;
}

function repeatingPatternV3(patternArr) {
  if (patternArr.length < 4) return null;
  const lastThree = patternArr.slice(-3).join('');
  const lastFour = patternArr.slice(-4).join('');
  let taiFollows = 0;
  let xiuFollows = 0;
  let totalMatches = 0;
  for (let i = 0; i < patternArr.length - 4; i++) {
    const sliceThree = patternArr.slice(i, i + 3).join('');
    const sliceFour = patternArr.slice(i, i + 4).join('');
    let isMatch = false;
    if (lastThree === sliceThree) {
      isMatch = true;
    } else if (lastFour === sliceFour) {
      isMatch = true;
    }
    if (isMatch && i + 4 < patternArr.length) {
      totalMatches++;
      if (patternArr[i + 4] === 'T') {
        taiFollows++;
      } else {
        xiuFollows++;
      }
    }
  }
  if (totalMatches < 3) return null;
  if (taiFollows / totalMatches > 0.65) return "Tài";
  if (xiuFollows / totalMatches > 0.65) return "Xỉu";
  return null;
}

function detectBiasV3(patternArr) {
  if (patternArr.length < 5) return null;
  let taiCount = 0;
  let xiuCount = 0;
  patternArr.forEach(result => {
    if (result === 'T') taiCount++;
    else xiuCount++;
  });
  const total = taiCount + xiuCount;
  if (total === 0) return null;
  const taiRatio = taiCount / total;
  const xiuRatio = xiuCount / total;
  if (taiRatio > 0.60) return "Tài";
  if (xiuRatio > 0.60) return "Xỉu";
  return null;
}

function predictLogic21(history) {
  if (history.length < 20) return null;
  const patternArr = history.map(s => s.result === 'Tài' ? 'T' : 'X');
  const voteCounts = { Tài: 0, Xỉu: 0 };
  let totalWeightSum = 0;
  const windows = [3, 5, 8, 12, 20, 30, 40, 60, 80];
  for (const win of windows) {
    if (patternArr.length < win) continue;
    const subPattern = patternArr.slice(0, win);
    const weight = win / 10;
    const markovRes = markovWeightedV3(subPattern.slice().reverse());
    if (markovRes) {
      voteCounts[markovRes] += weight * 0.7;
      totalWeightSum += weight * 0.7;
    }
    const repeatRes = repeatingPatternV3(subPattern.slice().reverse());
    if (repeatRes) {
      voteCounts[repeatRes] += weight * 0.15;
      totalWeightSum += weight * 0.15;
    }
    const biasRes = detectBiasV3(subPattern);
    if (biasRes) {
      voteCounts[biasRes] += weight * 0.15;
      totalWeightSum += weight * 0.15;
    }
  }
  if (totalWeightSum === 0) return null;
  if (voteCounts.Tài > voteCounts.Xỉu * 1.08) {
    return "Tài";
  } else if (voteCounts.Xỉu > voteCounts.Tài * 1.08) {
    return "Xỉu";
  } else {
    return null;
  }
}

function predictLogic22(history, cauLogData) {
  if (history.length < 15) return null;
  const resultsOnly = history.map(s => s.result === 'Tài' ? 'T' : 'X');
  const totalsOnly = history.map(s => s.total);
  let taiVotes = 0;
  let xiuVotes = 0;
  let totalContributionWeight = 0;
  const currentStreakResult = resultsOnly[0];
  let currentStreakLength = 0;
  for(let i=0; i<resultsOnly.length; i++) {
    if(resultsOnly[i] === currentStreakResult) {
      currentStreakLength++;
    } else {
      break;
    }
  }
  if (currentStreakLength >= 3) {
    let streakBreakCount = 0;
    let streakContinueCount = 0;
    const streakSearchWindow = Math.min(resultsOnly.length, 200);
    for (let i = currentStreakLength; i < streakSearchWindow; i++) {
      const potentialStreak = resultsOnly.slice(i, i + currentStreakLength);
      if (potentialStreak.every(r => r === currentStreakResult)) {
        if (resultsOnly[i - 1]) {
          if (resultsOnly[i - 1] === currentStreakResult) {
            streakContinueCount++;
          } else {
            streakBreakCount++;
          }
        }
      }
    }
    const totalStreakOccurrences = streakBreakCount + streakContinueCount;
    if (totalStreakOccurrences > 5) {
      if (streakBreakCount / totalStreakOccurrences > 0.65) {
        if (currentStreakResult === 'T') xiuVotes += 1.5; else taiVotes += 1.5;
        totalContributionWeight += 1.5;
      } else if (streakContinueCount / totalStreakOccurrences > 0.65) {
        if (currentStreakResult === 'T') taiVotes += 1.5; else xiuVotes += 1.5;
        totalContributionWeight += 1.5;
      }
    }
  }
  if (history.length >= 4) {
    const lastFour = resultsOnly.slice(0, 4).join('');
    let patternMatches = 0;
    let taiFollows = 0;
    let xiuFollows = 0;
    const patternToMatch = lastFour.substring(0, 3);
    const searchLength = Math.min(resultsOnly.length, 150);
    for(let i = 0; i < searchLength - 3; i++) {
      const historicalPattern = resultsOnly.slice(i, i + 3).join('');
      if (historicalPattern === patternToMatch) {
        if (resultsOnly[i + 3] === 'T') taiFollows++;
        else xiuFollows++;
        patternMatches++;
      }
    }
    if (patternMatches > 4) {
      if (taiFollows / patternMatches > 0.70) {
        taiVotes += 1.2; totalContributionWeight += 1.2;
      } else if (xiuFollows / patternMatches > 0.70) {
        xiuVotes += 1.2; totalContributionWeight += 1.2;
      }
    }
  }
  if (history.length >= 2) {
    const lastTwoTotals = totalsOnly.slice(0, 2);
    const lastTwoResults = resultsOnly.slice(0, 2);
    if (lastTwoTotals.length === 2) {
      const targetPatternKey = `${lastTwoTotals[1]}-${lastTwoResults[1]}_${lastTwoTotals[0]}-${lastTwoResults[0]}`;
      let taiFollows = 0;
      let xiuFollows = 0;
      let totalPatternMatches = 0;
      const relevantLogs = cauLogData.filter(log => log.patterns && log.patterns.sum_sequence_patterns);
      for (const log of relevantLogs) {
        for (const pattern of log.patterns.sum_sequence_patterns) {
          if (pattern.key === targetPatternKey) {
            totalPatternMatches++;
            if (log.actual_result === "Tài") taiFollows++;
            else xiuFollows++;
          }
        }
      }
      if (totalPatternMatches > 3) {
        if (taiFollows / totalPatternMatches > 0.70) { taiVotes += 1.0; totalContributionWeight += 1.0; }
        else if (xiuFollows / totalPatternMatches > 0.70) { xiuVotes += 1.0; totalContributionWeight += 1.0; }
      }
    }
  }
  if (totalContributionWeight === 0) return null;
  if (taiVotes > xiuVotes * 1.1) {
    return "Tài";
  } else if (xiuVotes > taiVotes * 1.1) {
    return "Xỉu";
  }
  return null;
}

function predictLogic23(history) {
  if (history.length < 5) return null;
  const totals = history.map(s => s.total);
  const lastResults = history.map(s => s.result);
  const allDice = history.slice(0, Math.min(history.length, 10)).flatMap(s => [s.d1, s.d2, s.d3]);
  const diceFreq = getDiceFrequencies(history, 10);
  const avg_total = totals.slice(0, Math.min(history.length, 10)).reduce((a, b) => a + b, 0) / Math.min(history.length, 10);
  const simplePredictions = [];
  if (history.length >= 2) {
    if ((totals[0] + totals[1]) % 2 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (avg_total > 10.5) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  if (diceFreq[4] + diceFreq[5] > diceFreq[1] + diceFreq[2]) {
    simplePredictions.push("Tài");
  } else {
    simplePredictions.push("Xỉu");
  }
  if (history.filter(s => s.total > 10).length > history.length / 2) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  if (history.length >= 3) {
    if (totals.slice(0, 3).reduce((a, b) => a + b, 0) > 33) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (history.length >= 5) {
    if (Math.max(...totals.slice(0, 5)) > 15) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (history.length >= 5) {
    if (totals.slice(0, 5).filter(t => t > 10).length >= 3) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (history.length >= 3) {
    if (totals.slice(0, 3).reduce((a, b) => a + b, 0) > 34) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (history.length >= 2) {
    if (totals[0] > 10 && totals[1] > 10) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
    if (totals[0] < 10 && totals[1] < 10) simplePredictions.push("Xỉu"); else simplePredictions.push("Tài");
  }
  if (history.length >= 1) {
    if ((totals[0] + diceFreq[3]) % 2 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
    if (diceFreq[2] > 3) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
    if ([11, 12, 13].includes(totals[0])) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (history.length >= 2) {
    if (totals[0] + totals[1] > 30) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (allDice.filter(d => d > 3).length > 7) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  if (history.length >= 1) {
    if (totals[0] % 2 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (allDice.filter(d => d > 3).length > 8) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  if (history.length >= 3) {
    if (totals.slice(0, 3).reduce((a, b) => a + b, 0) % 4 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
    if (totals.slice(0, 3).reduce((a, b) => a + b, 0) % 3 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (history.length >= 1) {
    if (totals[0] % 3 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
    if (totals[0] % 5 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
    if (totals[0] % 4 === 0) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  }
  if (diceFreq[4] > 2) simplePredictions.push("Tài"); else simplePredictions.push("Xỉu");
  let taiVotes = 0;
  let xiuVotes = 0;
  simplePredictions.forEach(p => {
    if (p === "Tài") taiVotes++;
    else if (p === "Xỉu") xiuVotes++;
  });
  if (taiVotes > xiuVotes * 1.5) {
    return "Tài";
  } else if (xiuVotes > taiVotes * 1.5) {
    return "Xỉu";
  }
  return null;
}

const PATTERN_DATA = {
  "ttxttx": { tai: 80, xiu: 20 }, "xxttxx": { tai: 25, xiu: 75 },
  "ttxxtt": { tai: 75, xiu: 25 }, "txtxt": { tai: 60, xiu: 40 },
  "xtxtx": { tai: 40, xiu: 60 }, "ttx": { tai: 70, xiu: 30 },
  "xxt": { tai: 30, xiu: 70 }, "txt": { tai: 65, xiu: 35 },
  "xtx": { tai: 35, xiu: 65 }, "tttt": { tai: 85, xiu: 15 },
  "xxxx": { tai: 15, xiu: 85 }, "ttttt": { tai: 88, xiu: 12 },
  "xxxxx": { tai: 12, xiu: 88 }, "tttttt": { tai: 92, xiu: 8 },
  "xxxxxx": { tai: 8, xiu: 92 }, "tttx": { tai: 75, xiu: 25 },
  "xxxt": { tai: 25, xiu: 75 }, "ttxtx": { tai: 78, xiu: 22 },
  "xxtxt": { tai: 22, xiu: 78 }, "txtxtx": { tai: 82, xiu: 18 },
  "xtxtxt": { tai: 18, xiu: 82 }, "ttxtxt": { tai: 85, xiu: 15 },
  "xxtxtx": { tai: 15, xiu: 85 }, "txtxxt": { tai: 83, xiu: 17 },
  "xtxttx": { tai: 17, xiu: 83 }, "ttttttt": { tai: 95, xiu: 5 },
  "xxxxxxx": { tai: 5, xiu: 95 }, "tttttttt": { tai: 97, xiu: 3 },
  "xxxxxxxx": { tai: 3, xiu: 97 }, "txtx": { tai: 60, xiu: 40 },
  "xtxt": { tai: 40, xiu: 60 }, "txtxt": { tai: 65, xiu: 35 },
  "xtxtx": { tai: 35, xiu: 65 }, "txtxtxt": { tai: 70, xiu: 30 },
  "xtxtxtx": { tai: 30, xiu: 70 }
};

function analyzePatterns(lastResults) {
  if (!lastResults || lastResults.length === 0) return [null, "Không có dữ liệu"];
  const resultsShort = lastResults.map(r => r === "Tài" ? "T" : "X");
  const displayLength = Math.min(resultsShort.length, 10);
  const recentSequence = resultsShort.slice(0, displayLength).join('');
  return [null, `: ${recentSequence}`];
}

function predictLogic24(history) {
  if (!history || history.length < 5) return null;
  const lastResults = history.map(s => s.result);
  const totals = history.map(s => s.total);
  const allDice = history.flatMap(s => [s.d1, s.d2, s.d3]);
  const diceFreq = new Array(7).fill(0);
  allDice.forEach(d => { if (d >= 1 && d <= 6) diceFreq[d]++; });
  const avg_total = totals.slice(0, Math.min(history.length, 10)).reduce((a, b) => a + b, 0) / Math.min(history.length, 10);
  const votes = [];
  if (history.length >= 2) {
    if ((totals[0] + totals[1]) % 2 === 0) votes.push("Tài"); else votes.push("Xỉu");
  }
  if (avg_total > 10.5) votes.push("Tài"); else votes.push("Xỉu");
  if (diceFreq[4] + diceFreq[5] > diceFreq[1] + diceFreq[2]) {
    votes.push("Tài");
  } else {
    votes.push("Xỉu");
  }
  if (history.filter(s => s.total > 10).length > history.length / 2) votes.push("Tài"); else votes.push("Xỉu");
  if (history.length >= 3) {
    if (totals.slice(0, 3).reduce((a, b) => a + b, 0) > 33) votes.push("Tài"); else votes.push("Xỉu");
  }
  if (history.length >= 5) {
    if (Math.max(...totals.slice(0, 5)) > 15) votes.push("Tài"); else votes.push("Xỉu");
  }
  const patternSeq = lastResults.slice(0, 3).reverse().map(r => r === "Tài" ? "t" : "x").join("");
  if (PATTERN_DATA[patternSeq]) {
    const prob = PATTERN_DATA[patternSeq];
    if (prob.tai > prob.xiu + 15) votes.push("Tài");
    else if (prob.xiu > prob.tai + 15) votes.push("Xỉu");
  }
  const [patternPred, patternDesc] = analyzePatterns(lastResults);
  if (patternPred) votes.push(patternPred);
  const taiCount = votes.filter(v => v === "Tài").length;
  const xiuCount = votes.filter(v => v === "Xỉu").length;
  if (taiCount + xiuCount < 4) return null;
  if (taiCount >= xiuCount + 3) return "Tài";
  if (xiuCount >= taiCount + 3) return "Xỉu";
  return null;
}

function analyzeAndExtractPatterns(history) {
  const patterns = {};
  if (history.length >= 2) {
    patterns.sum_sequence_patterns = [
      { key: `${history[0].total}-${history[0].result === 'Tài' ? 'T' : 'X'}_${history[1]?.total}-${history[1]?.result === 'Tài' ? 'T' : 'X'}` }
    ];
  }
  if (history.length >= 1) {
    let currentStreakLength = 0;
    const currentResult = history[0].result;
    for (let i = 0; i < history.length; i++) {
      if (history[i].result === currentResult) {
        currentStreakLength++;
      } else {
        break;
      }
    }
    if (currentStreakLength > 0) {
      patterns.last_streak = { result: currentResult === 'Tài' ? 'T' : 'X', length: currentStreakLength };
    }
  }
  if (history.length >= 3) {
    const resultsShort = history.slice(0, 3).map(s => s.result === 'Tài' ? 'T' : 'X').join('');
    if (resultsShort === 'TXT' || resultsShort === 'XTX') {
      patterns.alternating_pattern = resultsShort;
    }
  }
  return patterns;
}

async function predictLogic20(history, logicPerformance, cauLogData) {
  if (history.length < 30) return null;
  let taiVotes = 0;
  let xiuVotes = 0;
  const contributingLogicsNames = new Set();
  const signals = [
    { logic: 'logic1', baseWeight: 0.8 },
    { logic: 'logic2', baseWeight: 0.7 },
    { logic: 'logic3', baseWeight: 0.9 },
    { logic: 'logic4', baseWeight: 1.2 },
    { logic: 'logic5', baseWeight: 0.6 },
    { logic: 'logic6', baseWeight: 0.8 },
    { logic: 'logic7', baseWeight: 1.0 },
    { logic: 'logic8', baseWeight: 0.7 },
    { logic: 'logic9', baseWeight: 1.1 },
    { logic: 'logic10', baseWeight: 0.9 },
    { logic: 'logic11', baseWeight: 1.3 },
    { logic: 'logic12', baseWeight: 0.7 },
    { logic: 'logic13', baseWeight: 1.2 },
    { logic: 'logic14', baseWeight: 0.8 },
    { logic: 'logic15', baseWeight: 0.6 },
    { logic: 'logic16', baseWeight: 0.7 },
    { logic: 'logic17', baseWeight: 0.9 },
    { logic: 'logic18', baseWeight: 1.3 },
    { logic: 'logic19', baseWeight: 0.9 },
    { logic: 'logic21', baseWeight: 1.5 },
    { logic: 'logic22', baseWeight: 1.8 },
    { logic: 'logic23', baseWeight: 1.0 },
    { logic: 'logic24', baseWeight: 1.1 }
  ];
  const lastSession = history[0];
  const nextSessionId = lastSession.sid + 1;
  const childPredictions = {
    logic1: predictLogic1(lastSession, history),
    logic2: predictLogic2(nextSessionId, history),
    logic3: predictLogic3(history),
    logic4: predictLogic4(history),
    logic5: predictLogic5(history),
    logic6: predictLogic6(lastSession, history),
    logic7: predictLogic7(history),
    logic8: predictLogic8(history),
    logic9: predictLogic9(history),
    logic10: predictLogic10(history),
    logic11: predictLogic11(history),
    logic12: predictLogic12(lastSession, history),
    logic13: predictLogic13(history),
    logic14: predictLogic14(history),
    logic15: predictLogic15(history),
    logic16: predictLogic16(history),
    logic17: predictLogic17(history),
    logic18: predictLogic18(history),
    logic19: predictLogic19(history),
    logic21: predictLogic21(history),
    logic22: predictLogic22(history, cauLogData),
    logic23: predictLogic23(history),
    logic24: predictLogic24(history),
  };
  signals.forEach(signal => {
    const prediction = childPredictions[signal.logic];
    if (prediction !== null && logicPerformance[signal.logic]) {
      const acc = logicPerformance[signal.logic].accuracy;
      const consistency = logicPerformance[signal.logic].consistency;
      if (logicPerformance[signal.logic].total > 3 && acc > 0.35 && consistency > 0.25) {
        const effectiveWeight = signal.baseWeight * ((acc + consistency) / 2);
        if (prediction === "Tài") {
          taiVotes += effectiveWeight;
        } else {
          xiuVotes += effectiveWeight;
        }
        contributingLogicsNames.add(signal.logic);
      }
    }
  });
  const currentPatterns = analyzeAndExtractPatterns(history.slice(0, Math.min(history.length, 50)));
  let cauTaiBoost = 0;
  let cauXiuBoost = 0;
  if (cauLogData.length > 0) {
    const recentCauLogs = cauLogData.slice(Math.max(0, cauLogData.length - 200));
    const patternMatchScores = {};
    for (const patternType in currentPatterns) {
      const currentPatternValue = currentPatterns[patternType];
      if (patternType === 'sum_sequence_patterns' && Array.isArray(currentPatternValue)) {
        currentPatternValue.forEach(cp => {
          const patternKey = cp.key;
          if (patternKey) {
            recentCauLogs.forEach(logEntry => {
              if (logEntry.patterns && logEntry.patterns.sum_sequence_patterns) {
                const foundMatch = logEntry.patterns.sum_sequence_patterns.some(lp => lp.key === patternKey);
                if (foundMatch) {
                  if (!patternMatchScores[patternKey]) {
                    patternMatchScores[patternKey] = { tai: 0, xiu: 0 };
                  }
                  if (logEntry.actual_result === "Tài") patternMatchScores[patternKey].tai++;
                  else patternMatchScores[patternKey].xiu++;
                }
              }
            });
          }
        });
      } else if (currentPatternValue && typeof currentPatternValue === 'object' && currentPatternValue.result && currentPatternValue.length) {
        const patternKey = `last_streak_${currentPatternValue.result}_${currentPatternValue.length}`;
        recentCauLogs.forEach(logEntry => {
          if (logEntry.patterns && logEntry.patterns.last_streak) {
            const logStreak = logEntry.patterns.last_streak;
            if (logStreak.result === currentPatternValue.result && logStreak.length === currentPatternValue.length) {
              if (!patternMatchScores[patternKey]) {
                patternMatchScores[patternKey] = { tai: 0, xiu: 0 };
              }
              if (logEntry.actual_result === "Tài") patternMatchScores[patternKey].tai++;
              else patternMatchScores[patternKey].xiu++;
            }
          }
        });
      } else if (currentPatternValue) {
        const patternKey = `${patternType}_${currentPatternValue}`;
        recentCauLogs.forEach(logEntry => {
          if (logEntry.patterns && logEntry.patterns[patternType] === currentPatternValue) {
            if (!patternMatchScores[patternKey]) {
              patternMatchScores[patternKey] = { tai: 0, xiu: 0 };
            }
            if (logEntry.actual_result === "Tài") patternMatchScores[patternKey].tai++;
            else patternMatchScores[patternKey].xiu++;
          }
        });
      }
    }
    for (const key in patternMatchScores) {
      const stats = patternMatchScores[key];
      const totalMatches = stats.tai + stats.xiu;
      if (totalMatches > 3) {
        const taiRatio = stats.tai / totalMatches;
        const xiuRatio = stats.xiu / totalMatches;
        const CAU_LEARNING_THRESHOLD = 0.70;
        if (taiRatio >= CAU_LEARNING_THRESHOLD) {
          cauTaiBoost += (taiRatio - 0.5) * 2;
        } else if (xiuRatio >= CAU_LEARNING_THRESHOLD) {
          cauXiuBoost += (xiuRatio - 0.5) * 2;
        }
      }
    }
  }
  taiVotes += cauTaiBoost * 2;
  xiuVotes += cauXiuBoost * 2;
  const totalWeightedVotes = taiVotes + xiuVotes;
  if (totalWeightedVotes < 1.5) return null;
  if (taiVotes > xiuVotes * 1.08) {
    return "Tài";
  } else if (xiuVotes > taiVotes * 1.08) {
    return "Xỉu";
  }
  return null;
}

// ==================== BROADCAST PREDICTION (GIỮ NGUYÊN) ====================
async function broadcastPrediction() {
  db.all(`SELECT sid, d1, d2, d3, total, result, timestamp FROM sessions ORDER BY sid DESC LIMIT 1000`, async (err, rows) => {
    if (err) {
      console.error("Lỗi khi truy vấn DB để broadcast:", err.message);
      return;
    }
    const history = rows.filter(item =>
      item.d1 !== undefined && item.d2 !== undefined && item.d3 !== undefined &&
      item.d1 >= 1 && item.d1 <= 6 && item.d2 >= 1 && item.d2 <= 6 && item.d3 >= 1 && item.d3 <= 6 &&
      item.total >= 3 && item.total <= 18
    );
    const currentTimestamp = new Date().toLocaleString("vi-VN", {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    if (history.length < 5) {
      const message = {
        "phien_truoc": null,
        "ket_qua": null,
        "Dice": null,
        "phien_hien_tai": null,
        "du_doan": null,
        "do_tin_cay": "0.00%",
        "cau": "Chưa đủ dữ liệu",
        "ngay": currentTimestamp,
        "Id": "@hellokietne21"
      };
      connectedClients.forEach(clientWs => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(message));
        }
      });
      return;
    }
    const lastSession = history[0];
    const nextSessionId = lastSession.sid + 1;
    if (history.length > 1) {
      const sessionBeforeLast = history[1];
      const actualOutcomeOfLastSession = lastSession.result;
      const historyForEvaluation = history.slice(1);
      const cauLogDataForEval = await readCauLog();
      const predictionsForEvaluation = [
        { name: 'logic1', pred: predictLogic1(sessionBeforeLast, historyForEvaluation) },
        { name: 'logic2', pred: predictLogic2(sessionBeforeLast.sid, historyForEvaluation) },
        { name: 'logic3', pred: predictLogic3(historyForEvaluation) },
        { name: 'logic4', pred: predictLogic4(historyForEvaluation) },
        { name: 'logic5', pred: predictLogic5(historyForEvaluation) },
        { name: 'logic6', pred: predictLogic6(sessionBeforeLast, historyForEvaluation) },
        { name: 'logic7', pred: predictLogic7(historyForEvaluation) },
        { name: 'logic8', pred: predictLogic8(historyForEvaluation) },
        { name: 'logic9', pred: predictLogic9(historyForEvaluation) },
        { name: 'logic10', pred: predictLogic10(historyForEvaluation) },
        { name: 'logic11', pred: predictLogic11(historyForEvaluation) },
        { name: 'logic12', pred: predictLogic12(sessionBeforeLast, historyForEvaluation) },
        { name: 'logic13', pred: predictLogic13(historyForEvaluation) },
        { name: 'logic14', pred: predictLogic14(historyForEvaluation) },
        { name: 'logic15', pred: predictLogic15(historyForEvaluation) },
        { name: 'logic16', pred: predictLogic16(historyForEvaluation) },
        { name: 'logic17', pred: predictLogic17(historyForEvaluation) },
        { name: 'logic18', pred: predictLogic18(historyForEvaluation) },
        { name: 'logic19', pred: predictLogic19(historyForEvaluation) },
        { name: 'logic21', pred: predictLogic21(historyForEvaluation) },
        { name: 'logic22', pred: predictLogic22(historyForEvaluation, cauLogDataForEval) },
        { name: 'logic23', pred: predictLogic23(historyForEvaluation) },
        { name: 'logic24', pred: predictLogic24(historyForEvaluation) },
      ];
      predictionsForEvaluation.forEach(l => {
        if (logicPerformance[l.name]) {
          updateLogicPerformance(l.name, l.pred, actualOutcomeOfLastSession);
        }
      });
      const logic20_prediction_for_eval = await predictLogic20(historyForEvaluation, logicPerformance, cauLogDataForEval);
      updateLogicPerformance('logic20', logic20_prediction_for_eval, actualOutcomeOfLastSession);
      console.log("\n--- Logic Performance Update ---");
      for (const logicName in logicPerformance) {
        console.log(`  ${logicName}: Acc: ${logicPerformance[logicName].accuracy.toFixed(3)} | Cons: ${logicPerformance[logicName].consistency.toFixed(3)} | (Correct:${logicPerformance[logicName].correct.toFixed(2)}, Total:${logicPerformance[logicName].total.toFixed(2)})`);
      }
      console.log("-------------------------------\n");
      await saveLogicPerformance();
    }
    let finalPrediction = null;
    let overallConfidence = "0.00";
    let confidenceMessage = "Không có tín hiệu mạnh để dự đoán";
    let contributingLogics = [];
    let detectedPatternString = "";
    const cauLogDataForPrediction = await readCauLog();
    const logicsToEvaluate = [
      { name: 'logic1', predict: predictLogic1(lastSession, history) },
      { name: 'logic2', predict: predictLogic2(nextSessionId, history) },
      { name: 'logic3', predict: predictLogic3(history) },
      { name: 'logic4', predict: predictLogic4(history) },
      { name: 'logic5', predict: predictLogic5(history) },
      { name: 'logic6', predict: predictLogic6(lastSession, history) },
      { name: 'logic7', predict: predictLogic7(history) },
      { name: 'logic8', predict: predictLogic8(history) },
      { name: 'logic9', predict: predictLogic9(history) },
      { name: 'logic10', predict: predictLogic10(history) },
      { name: 'logic11', predict: predictLogic11(history) },
      { name: 'logic12', predict: predictLogic12(lastSession, history) },
      { name: 'logic13', predict: predictLogic13(history) },
      { name: 'logic14', predict: predictLogic14(history) },
      { name: 'logic15', predict: predictLogic15(history) },
      { name: 'logic16', predict: predictLogic16(history) },
      { name: 'logic17', predict: predictLogic17(history) },
      { name: 'logic18', predict: predictLogic18(history) },
      { name: 'logic19', predict: predictLogic19(history) },
      { name: 'logic21', predict: predictLogic21(history) },
      { name: 'logic22', predict: predictLogic22(history, cauLogDataForPrediction) },
      { name: 'logic23', predict: predictLogic23(history) },
      { name: 'logic24', predict: predictLogic24(history) },
    ];
    const allValidPredictions = [];
    for (const l of logicsToEvaluate) {
      const prediction = l.predict;
      if (prediction !== null && logicPerformance[l.name]) {
        const acc = logicPerformance[l.name].accuracy;
        const consistency = logicPerformance[l.name].consistency;
        if (logicPerformance[l.name].total > 2 && acc > 0.30 && consistency > 0.20) {
          allValidPredictions.push({ logic: l.name, prediction: prediction, accuracy: acc, consistency: consistency });
        }
      }
    }
    const logic20Result = await predictLogic20(history, logicPerformance, cauLogDataForPrediction);
    if (logic20Result !== null && logicPerformance.logic20.total > 5 && logicPerformance.logic20.accuracy >= 0.45) {
      allValidPredictions.push({
        logic: 'logic20',
        prediction: logic20Result,
        accuracy: logicPerformance.logic20.accuracy,
        consistency: logicPerformance.logic20.consistency
      });
    }
    allValidPredictions.sort((a, b) => (b.accuracy * b.consistency) - (a.accuracy * a.consistency));
    let taiWeightedVote = 0;
    let xiuWeightedVote = 0;
    let totalEffectiveWeight = 0;
    let usedLogics = new Set();
    for (const p of allValidPredictions) {
      const effectiveWeight = p.accuracy * p.consistency * (p.logic === 'logic20' ? 1.8 : (p.logic === 'logic22' ? 1.5 : (p.logic === 'logic23' ? 0.9 : (p.logic === 'logic24' ? 1.1 : 1.0))));
      if (effectiveWeight > 0.1) {
        if (p.prediction === "Tài") {
          taiWeightedVote += effectiveWeight;
        } else {
          xiuWeightedVote += effectiveWeight;
        }
        totalEffectiveWeight += effectiveWeight;
        if (!usedLogics.has(p.logic)) {
          contributingLogics.push(`${p.logic} (${(p.accuracy * 100).toFixed(1)}%)`);
          usedLogics.add(p.logic);
        }
      }
      if (contributingLogics.length >= 5) break;
    }
    if (totalEffectiveWeight > 0) {
      const taiConfidence = taiWeightedVote / totalEffectiveWeight;
      const xiuConfidence = xiuWeightedVote / totalEffectiveWeight;
      if (taiConfidence > xiuConfidence * 1.08 && taiConfidence >= 0.50) {
        finalPrediction = "Tài";
        overallConfidence = (taiConfidence * 100).toFixed(2);
        confidenceMessage = "Tin cậy";
        if (taiConfidence >= HIGH_CONFIDENCE_THRESHOLD) confidenceMessage = "Rất tin cậy";
      } else if (xiuConfidence > taiConfidence * 1.08 && xiuConfidence >= 0.50) {
        finalPrediction = "Xỉu";
        overallConfidence = (xiuConfidence * 100).toFixed(2);
        confidenceMessage = "Tin cậy";
        if (xiuConfidence >= HIGH_CONFIDENCE_THRESHOLD) confidenceMessage = "Rất tin cậy";
      } else {
        if (lastSession) {
          finalPrediction = lastSession.result;
          overallConfidence = "50.00";
          confidenceMessage = "Thấp (dự đoán theo xu hướng gần nhất)";
          contributingLogics = ["Fallback: Theo phien_truoc"];
        } else {
          finalPrediction = null;
          overallConfidence = "0.00";
          confidenceMessage = "Thấp";
          contributingLogics = ["Chưa có đủ lịch sử để đánh giá"];
        }
      }
    } else {
      if (lastSession) {
        finalPrediction = lastSession.result;
        overallConfidence = "50.00";
        confidenceMessage = "Thấp (dự đoán theo xu hướng gần nhất)";
        contributingLogics = ["Fallback: Theo phien_truoc"];
      } else {
        finalPrediction = null;
        overallConfidence = "0.00";
        confidenceMessage = "Thấp";
        contributingLogics = ["Chưa có đủ lịch sử để đánh giá"];
      }
    }
    const MAX_OVERALL_CONFIDENCE_DISPLAY = 97.00;
    if (overallConfidence !== "N/A") {
      overallConfidence = Math.min(parseFloat(overallConfidence), MAX_OVERALL_CONFIDENCE_DISPLAY).toFixed(2);
    }
    if (contributingLogics.length === 0 && allValidPredictions.length > 0) {
      contributingLogics.push(`${allValidPredictions[0].logic} (chủ đạo)`);
    } else if (contributingLogics.length === 0) {
      contributingLogics.push("Không có logic nào đạt ngưỡng");
    }
    const [patternPred, patternDesc] = analyzePatterns(history.map(item => item.result));
    detectedPatternString = patternDesc;
    const lastSessionDice = lastSession ? [lastSession.d1, lastSession.d2, lastSession.d3] : null;
    const lastSessionIdDisplay = lastSession ? lastSession.sid : null;
    const lastSessionResultDisplay = lastSession ? lastSession.result : null;
    const predictionMessage = {
      "phien_truoc": lastSessionIdDisplay,
      "ket_qua": lastSessionResultDisplay,
      "Dice": lastSessionDice,
      "phien_hien_tai": nextSessionId,
      "du_doan": finalPrediction,
      "do_tin_cay": `${overallConfidence}%`,
      "cau": detectedPatternString,
      "ngay": currentTimestamp,
      "Id": "@hellokietne21"
    };
    connectedClients.forEach(clientWs => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(predictionMessage));
      }
    });
    console.log(`\n--- Broadcasted Prediction for Session ${nextSessionId} ---`);
    console.log(`Final Prediction: ${finalPrediction}`);
    console.log(`Confidence: ${overallConfidence}% (${confidenceMessage})`);
    console.log(`Contributing Logics: ${contributingLogics.join(', ')}`);
    console.log(`Detected Pattern: ${detectedPatternString}`);
    console.log("------------------------------------------\n");
  });
}

// ==================== POLLING API ====================
async function initializeLatestSessionId() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT MAX(sid) as maxSid FROM sessions`, (err, row) => {
      if (err) {
        console.error("Lỗi lấy max sid:", err);
        resolve();
      } else {
        if (row && row.maxSid) {
          latestFetchedSessionId = row.maxSid;
          console.log(`[Init] Phiên lớn nhất trong DB: ${latestFetchedSessionId}`);
        } else {
          console.log(`[Init] Database trống, bắt đầu lấy từ API.`);
        }
        resolve();
      }
    });
  });
}

async function fetchAndProcessHistory() {
  if (isPolling) return;
  isPolling = true;
  try {
    console.log(`[Polling] Đang lấy dữ liệu từ API...`);
    const response = await axios.get(HISTORY_API_URL, { timeout: 10000 });
    if (response.data && response.data.status === 'ok' && Array.isArray(response.data.data)) {
      const sessions = response.data.data;
      sessions.sort((a, b) => a.sessionId - b.sessionId);
      for (const session of sessions) {
        const sessionId = parseInt(session.sessionId);
        if (sessionId > latestFetchedSessionId) {
          const dice = session.dice;
          const sum = session.sum;
          const result = session.result;
          if (!dice || dice.length !== 3 || !sum || !result) {
            console.warn(`[Polling] Dữ liệu phiên ${sessionId} không hợp lệ, bỏ qua.`);
            continue;
          }
          const existing = await new Promise((resolve, reject) => {
            db.get(`SELECT sid FROM sessions WHERE sid = ?`, [sessionId], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });
          if (!existing) {
            const timestamp = new Date(session.time).getTime();
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO sessions (sid, d1, d2, d3, total, result, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [sessionId, dice[0], dice[1], dice[2], sum, result, timestamp],
                function (err) {
                  if (err) reject(err);
                  else {
                    console.log(`✅ [Polling] Đã thêm phiên ${sessionId} - ${result} (${dice.join('-')})`);
                    resolve();
                  }
                }
              );
            });
            latestFetchedSessionId = sessionId;
            db.all(`SELECT sid, d1, d2, d3, total, result FROM sessions ORDER BY sid DESC LIMIT 50`, (histErr, recentHistory) => {
              if (!histErr && recentHistory.length > 5) {
                const reversedHistory = recentHistory.reverse();
                const patternsFound = analyzeAndExtractPatterns(reversedHistory);
                if (Object.keys(patternsFound).length > 0) {
                  logCauPattern({
                    sid_before: sessionId,
                    actual_result: result,
                    patterns: patternsFound,
                    timestamp
                  });
                }
              }
            });
            broadcastPrediction();
          } else {
            if (sessionId > latestFetchedSessionId) {
              latestFetchedSessionId = sessionId;
            }
          }
        }
      }
    } else {
      console.warn('[Polling] Phản hồi API không đúng định dạng:', response.data);
    }
  } catch (error) {
    console.error('[Polling] Lỗi khi fetch API:', error.message);
  } finally {
    isPolling = false;
  }
}

// ==================== ENDPOINTS ====================
fastify.get("/api/sunwin", async (request, reply) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT sid, d1, d2, d3, total, result, timestamp FROM sessions ORDER BY sid DESC LIMIT 1000`, async (err, rows) => {
      if (err) {
        console.error("Lỗi khi truy vấn DB:", err.message);
        reply.status(500).send({ error: "Lỗi nội bộ server." });
        return reject("Lỗi nội bộ server.");
      }
      const history = rows.filter(item =>
        item.d1 !== undefined && item.d2 !== undefined && item.d3 !== undefined &&
        item.d1 >= 1 && item.d1 <= 6 && item.d2 >= 1 && item.d2 <= 6 && item.d3 >= 1 && item.d3 <= 6 &&
        item.total >= 3 && item.total <= 18
      );
      const currentTimestamp = new Date().toLocaleString("vi-VN", {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
      if (history.length < 5) {
        reply.type('application/json').send({
          "phien_truoc": null,
          "ket_qua": null,
          "Dice": null,
          "phien_hien_tai": null,
          "du_doan": null,
          "do_tin_cay": "0.00%",
          "cau": "Chưa đủ dữ liệu",
          "ngay": currentTimestamp,
          "Id": "Kietdev"
        });
        return resolve();
      }
      const lastSession = history[0];
      const nextSessionId = lastSession.sid + 1;
      let finalPrediction = null;
      let overallConfidence = "0.00";
      let confidenceMessage = "Không có tín hiệu mạnh để dự đoán";
      let contributingLogics = [];
      let detectedPatternString = "";
      const cauLogDataForPrediction = await readCauLog();
      const logicsToEvaluate = [
        { name: 'logic1', predict: predictLogic1(lastSession, history) },
        { name: 'logic2', predict: predictLogic2(nextSessionId, history) },
        { name: 'logic3', predict: predictLogic3(history) },
        { name: 'logic4', predict: predictLogic4(history) },
        { name: 'logic5', predict: predictLogic5(history) },
        { name: 'logic6', predict: predictLogic6(lastSession, history) },
        { name: 'logic7', predict: predictLogic7(history) },
        { name: 'logic8', predict: predictLogic8(history) },
        { name: 'logic9', predict: predictLogic9(history) },
        { name: 'logic10', predict: predictLogic10(history) },
        { name: 'logic11', predict: predictLogic11(history) },
        { name: 'logic12', predict: predictLogic12(lastSession, history) },
        { name: 'logic13', predict: predictLogic13(history) },
        { name: 'logic14', predict: predictLogic14(history) },
        { name: 'logic15', predict: predictLogic15(history) },
        { name: 'logic16', predict: predictLogic16(history) },
        { name: 'logic17', predict: predictLogic17(history) },
        { name: 'logic18', predict: predictLogic18(history) },
        { name: 'logic19', predict: predictLogic19(history) },
        { name: 'logic21', predict: predictLogic21(history) },
        { name: 'logic22', predict: predictLogic22(history, cauLogDataForPrediction) },
        { name: 'logic23', predict: predictLogic23(history) },
        { name: 'logic24', predict: predictLogic24(history) },
      ];
      const allValidPredictions = [];
      for (const l of logicsToEvaluate) {
        const prediction = l.predict;
        if (prediction !== null && logicPerformance[l.name]) {
          const acc = logicPerformance[l.name].accuracy;
          const consistency = logicPerformance[l.name].consistency;
          if (logicPerformance[l.name].total > 2 && acc > 0.30 && consistency > 0.20) {
            allValidPredictions.push({ logic: l.name, prediction: prediction, accuracy: acc, consistency: consistency });
          }
        }
      }
      const logic20Result = await predictLogic20(history, logicPerformance, cauLogDataForPrediction);
      if (logic20Result !== null && logicPerformance.logic20.total > 5 && logicPerformance.logic20.accuracy >= 0.45) {
        allValidPredictions.push({
          logic: 'logic20',
          prediction: logic20Result,
          accuracy: logicPerformance.logic20.accuracy,
          consistency: logicPerformance.logic20.consistency
        });
      }
      allValidPredictions.sort((a, b) => (b.accuracy * b.consistency) - (a.accuracy * a.consistency));
      let taiWeightedVote = 0;
      let xiuWeightedVote = 0;
      let totalEffectiveWeight = 0;
      let usedLogics = new Set();
      for (const p of allValidPredictions) {
        const effectiveWeight = p.accuracy * p.consistency * (p.logic === 'logic20' ? 1.8 : (p.logic === 'logic22' ? 1.5 : (p.logic === 'logic23' ? 0.9 : (p.logic === 'logic24' ? 1.1 : 1.0))));
        if (effectiveWeight > 0.1) {
          if (p.prediction === "Tài") {
            taiWeightedVote += effectiveWeight;
          } else {
            xiuWeightedVote += effectiveWeight;
          }
          totalEffectiveWeight += effectiveWeight;
          if (!usedLogics.has(p.logic)) {
            contributingLogics.push(`${p.logic} (${(p.accuracy * 100).toFixed(1)}%)`);
            usedLogics.add(p.logic);
          }
        }
        if (contributingLogics.length >= 5) break;
      }
      if (totalEffectiveWeight > 0) {
        const taiConfidence = taiWeightedVote / totalEffectiveWeight;
        const xiuConfidence = xiuWeightedVote / totalEffectiveWeight;
        if (taiConfidence > xiuConfidence * 1.08 && taiConfidence >= 0.50) {
          finalPrediction = "Tài";
          overallConfidence = (taiConfidence * 100).toFixed(2);
          confidenceMessage = "Tin cậy";
          if (taiConfidence >= HIGH_CONFIDENCE_THRESHOLD) confidenceMessage = "Rất tin cậy";
        } else if (xiuConfidence > taiConfidence * 1.08 && xiuConfidence >= 0.50) {
          finalPrediction = "Xỉu";
          overallConfidence = (xiuConfidence * 100).toFixed(2);
          confidenceMessage = "Tin cậy";
          if (xiuConfidence >= HIGH_CONFIDENCE_THRESHOLD) confidenceMessage = "Rất tin cậy";
        } else {
          if (lastSession) {
            finalPrediction = lastSession.result;
            overallConfidence = "50.00";
            confidenceMessage = "Thấp (dự đoán theo xu hướng gần nhất)";
            contributingLogics = ["Fallback: Theo phien_truoc"];
          } else {
            finalPrediction = null;
            overallConfidence = "0.00";
            confidenceMessage = "Thấp";
            contributingLogics = ["Chưa có đủ lịch sử để đánh giá"];
          }
        }
      } else {
        if (lastSession) {
          finalPrediction = lastSession.result;
          overallConfidence = "50.00";
          confidenceMessage = "Thấp (dự đoán theo xu hướng gần nhất)";
          contributingLogics = ["Fallback: Theo phien_truoc"];
        } else {
          finalPrediction = null;
          overallConfidence = "0.00";
          confidenceMessage = "Thấp";
          contributingLogics = ["Chưa có đủ lịch sử để đánh giá"];
        }
      }
      const MAX_OVERALL_CONFIDENCE_DISPLAY = 97.00;
      if (overallConfidence !== "N/A") {
        overallConfidence = Math.min(parseFloat(overallConfidence), MAX_OVERALL_CONFIDENCE_DISPLAY).toFixed(2);
      }
      if (contributingLogics.length === 0 && allValidPredictions.length > 0) {
        contributingLogics.push(`${allValidPredictions[0].logic} (chủ đạo)`);
      } else if (contributingLogics.length === 0) {
        contributingLogics.push("Không có logic nào đạt ngưỡng");
      }
      const [patternPred, patternDesc] = analyzePatterns(history.map(item => item.result));
      detectedPatternString = patternDesc;
      const lastSessionDice = lastSession ? [lastSession.d1, lastSession.d2, lastSession.d3] : null;
      const lastSessionIdDisplay = lastSession ? lastSession.sid : null;
      const lastSessionResultDisplay = lastSession ? lastSession.result : null;
      reply.type('application/json').send({
        "phien_truoc": lastSessionIdDisplay,
        "ket_qua": lastSessionResultDisplay,
        "Dice": lastSessionDice,
        "phien_hien_tai": nextSessionId,
        "du_doan": finalPrediction,
        "do_tin_cay": `${overallConfidence}%`,
        "cau": detectedPatternString,
        "ngay": currentTimestamp,
        "Id": "Kietdev"
      });
      resolve();
    });
  });
});

fastify.get("/api/history-json", async (request, reply) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT sid, d1, d2, d3, total, result, timestamp FROM sessions ORDER BY sid ASC`, (err, rows) => {
      if (err) {
        console.error("Lỗi khi truy vấn DB để xuất JSON:", err.message);
        reply.status(500).send("Lỗi nội bộ server khi xuất dữ liệu.");
        return reject("Lỗi nội bộ server khi xuất dữ liệu.");
      }
      const validHistory = rows.filter(item =>
        item.d1 !== undefined && item.d2 !== undefined && item.d3 !== undefined &&
        item.d1 >= 1 && item.d1 <= 6 && item.d2 >= 1 && item.d2 <= 6 && item.d3 >= 1 && item.d3 <= 6 &&
        item.total >= 3 && item.total <= 18
      );
      const jsonFilePath = path.resolve(__dirname, 'sun_history.json');
      fs.writeFile(jsonFilePath, JSON.stringify(validHistory, null, 2), (writeErr) => {
        if (writeErr) {
          console.error("Lỗi khi ghi file JSON:", writeErr.message);
          reply.status(500).send("Lỗi nội bộ server khi ghi file JSON.");
          return reject("Lỗi nội bộ server khi ghi file JSON.");
        }
        console.log(`Đã xuất lịch sử phiên ra: ${jsonFilePath}`);
        reply.type('application/json').send(JSON.stringify(validHistory, null, 2));
        resolve();
      });
    });
  });
});

fastify.get("/ws/sunwin", { websocket: true }, (connection, req) => {
  const { key } = req.query;
  if (key !== API_KEY) {
    connection.socket.send(JSON.stringify({ error: "Sai key truy cập WebSocket!" }));
    connection.socket.close();
    return;
  }
  connectedClients.add(connection.socket);
  console.log("Client mới đã kết nối WebSocket.");
  broadcastPrediction();
  connection.socket.on("close", () => {
    connectedClients.delete(connection.socket);
    console.log("Client đã ngắt kết nối WebSocket.");
  });
  connection.socket.send(JSON.stringify({ message: "Kết nối thành công tới Sunwin WebSocket Server!" }));
});

// ==================== KHỞI ĐỘNG SERVER ====================
async function initializeLogicPerformanceFromLog() {
  console.log("Initializing logic performance from historical cau log data...");
  const cauLogData = await readCauLog();
  if (cauLogData.length === 0) {
    console.log("No historical cau log data found for initialization.");
    return;
  }
  const reconstructedHistory = [];
  cauLogData.forEach(entry => {
    reconstructedHistory.push({ result: entry.actual_result });
  });
  if (reconstructedHistory.length > 1) {
    for (let i = 0; i < reconstructedHistory.length - 1; i++) {
      const actualResult = reconstructedHistory[i].result;
      const simulatedHistoryForLogic20 = cauLogData.slice(i + 1).map(entry => ({ result: entry.actual_result }));
      if (simulatedHistoryForLogic20.length > 30) {
        const logic20_prediction = await predictLogic20(simulatedHistoryForLogic20, logicPerformance, cauLogData.slice(0, i));
        if (logic20_prediction !== null) {
          updateLogicPerformance('logic20', logic20_prediction, actualResult);
        }
      }
    }
    console.log("Logic performance initialized for Logic20 from historical cau log data.");
    await saveLogicPerformance();
  } else {
    console.log("Not enough historical cau log data to meaningfully initialize logic performance for Logic20.");
  }
}

const start = async () => {
  try {
    await loadLogicPerformance();
    await initializeLogicPerformanceFromLog();
    await initializeLatestSessionId();
    await fetchAndProcessHistory();
    setInterval(fetchAndProcessHistory, POLLING_INTERVAL);
    console.log(`[Polling] Đã bắt đầu polling API mỗi ${POLLING_INTERVAL / 1000} giây.`);
    const address = await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Server Fastify đang chạy tại ${address}`);
    console.log(`HTTP API (for testing): http://localhost:${PORT}/api/sunwin?key=${API_KEY}`);
    console.log(`History JSON (for testing): http://localhost:${PORT}/api/history-json?key=${API_KEY}`);
    console.log(`WebSocket API: ws://YOUR_PUBLIC_IP:${PORT}/ws/sunwin?key=${API_KEY}`);
  } catch (err) {
    console.error("Lỗi khi khởi động server:", err);
    process.exit(1);
  }
};

start();
