import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
    Search, TrendingUp, AlertCircle, BrainCircuit, 
    Activity, TrendingDown, Info, ChevronRight,
    BarChart3, LayoutDashboard, Settings, HelpCircle
} from 'lucide-react';
import {
    Area, XAxis, YAxis, CartesianGrid, Tooltip, 
    ResponsiveContainer, Line, ComposedChart, Legend
} from 'recharts';
import { GoogleGenAI } from "@google/genai";

// --- 1. Types & Constants ---
const PROXY_URL = 'https://corsproxy.io/?';
const RIVER_ZONES = {
    ExtremelyHigh: "極高估",
    High: "高估",
    Fair: "合理",
    Low: "低估",
    ExtremelyLow: "極低",
    Unknown: "未知"
};

// --- 2. Utils ---
function calculateSMA(data: (number | null)[], window: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < window - 1) {
            sma.push(data[i] || 0);
        } else {
            const slice = data.slice(i - window + 1, i + 1);
            const valid = slice.filter(v => v !== null && v !== undefined) as number[];
            const sum = valid.reduce((a, b) => a + b, 0);
            sma.push(valid.length > 0 ? sum / valid.length : 0);
        }
    }
    return sma;
}

const formatSymbol = (input: string) => {
    let s = input.trim().toUpperCase();
    if (s.includes('.')) return s;
    if (/^\d/.test(s)) return `${s}.TW`;
    return s;
};

// --- 3. Services ---
const fetchStockData = async (symbol: string) => {
    // A. Fetch Quote Info (Fundamental)
    const quoteUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`);
    let quote: any = null;
    try {
        const quoteRes = await fetch(`${PROXY_URL}${quoteUrl}`);
        const quoteData = await quoteRes.json();
        quote = quoteData.quoteResponse?.result?.[0];
    } catch (e) {
        console.warn("Fundamental fetch failed, fallback to chart only.");
    }

    // B. Fetch Chart Data (Historical)
    const chartUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`);
    const chartRes = await fetch(`${PROXY_URL}${chartUrl}`);
    if (!chartRes.ok) throw new Error(`查無此代碼 "${symbol}"。請確認輸入是否正確（台股請加 .TW）。`);
    
    const chartData = await chartRes.json();
    const result = chartData.chart.result?.[0];
    if (!result) throw new Error("Yahoo Finance 未能提供該代碼的歷史數據。");

    const prices = result.indicators.quote[0].close;
    const timestamps = result.timestamp;
    const meta = result.meta;

    const ma200 = calculateSMA(prices, 200);
    const ma60 = calculateSMA(prices, 60);

    const info = {
        symbol: meta.symbol || symbol,
        shortName: quote?.longName || quote?.shortName || meta.symbol || symbol,
        currency: meta.currency || 'TWD',
        regularMarketPrice: meta.regularMarketPrice || prices[prices.length - 1],
        regularMarketChangePercent: quote?.regularMarketChangePercent || 0,
        trailingEps: quote?.epsTrailingTwelveMonths,
        trailingPE: quote?.trailingPE,
        type: quote?.quoteType || meta.instrumentType
    };

    const eps = info.trailingEps || 0;
    const useEpsModel = eps > 0 && info.type === 'EQUITY';
    const multipliers = useEpsModel ? [12, 16, 20, 24, 28] : [0.8, 1.0, 1.2, 1.4, 1.6];

    const history = timestamps.map((t: number, i: number) => {
        const center = ma200[i];
        const d = new Date(t * 1000);
        const bands = useEpsModel ? multipliers.map(m => eps * m) : multipliers.map(m => center * m);
        return {
            date: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
            timestamp: t,
            price: prices[i],
            ma60: ma60[i],
            ma200: center,
            riverBands: bands,
        };
    });

    return { history, info };
};

const analyzeStock = async (info: any, current: any) => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return "API Key 未設定，無法提供智慧診斷。";
    
    const ai = new GoogleGenAI({ apiKey });
    const bands = current.riverBands;
    let zone = RIVER_ZONES.Unknown;
    if (current.price > bands[4]) zone = RIVER_ZONES.ExtremelyHigh;
    else if (current.price > bands[3]) zone = RIVER_ZONES.High;
    else if (current.price > bands[2]) zone = RIVER_ZONES.Fair;
    else if (current.price > bands[1]) zone = RIVER_ZONES.Low;
    else zone = RIVER_ZONES.ExtremelyLow;

    const prompt = `
        你是一位資深金融分析師。請基於以下數據提供繁體中文 (zh-TW) 深度解讀。
        標的：${info.symbol} (${info.shortName})
        價格：${current.price.toFixed(2)} ${info.currency}
        真實 EPS (TTM)：${info.trailingEps || '無數據'}
        模型類型：${info.trailingEps > 0 ? '本益比河流圖' : '價值中心河流圖'}
        當前位階：${zone}
        
        河流區間(由低到高)：[${bands.map((b: number) => b.toFixed(1)).join(', ')}]
        技術面：60MA=${current.ma60.toFixed(2)}, 200MA=${current.ma200.toFixed(2)}

        請精簡回答：
        1. 估值狀態解讀（便宜、合理或昂貴）。
        2. 關鍵支撐與壓力位分析。
        3. 中長期操作建議。
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });
        return response.text;
    } catch (err) {
        return "AI 分析暫時不可用，請參考圖表位階。";
    }
};

// --- 4. Components ---
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl text-[11px] backdrop-blur-md">
                <p className="font-bold text-slate-300 mb-2 border-b border-slate-700 pb-1">{label}</p>
                <div className="space-y-1">
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex justify-between gap-6">
                            <span className="flex items-center gap-1.5 text-slate-400">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color || entry.fill }}></span>
                                {entry.name}:
                            </span>
                            <span className="font-mono text-white font-medium">{Number(entry.value).toFixed(2)}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    return null;
};

const StockChart = ({ data }: { data: any[] }) => {
    const chartData = useMemo(() => data.slice(199), [data]);
    return (
        <div className="w-full h-[500px] glass-panel rounded-3xl p-6 shadow-2xl relative group overflow-hidden">
            <div className="absolute top-6 left-6 z-10 text-[10px] font-black text-slate-500 flex items-center gap-2 uppercase tracking-widest opacity-60">
                <Activity className="w-3 h-3 text-amber-500"/> Market Intelligence Visualization
            </div>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 30, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} minTickGap={60} />
                    <YAxis orientation="right" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    
                    <Area name="極低區" type="monotone" dataKey={(d) => d.riverBands[0]} stroke="none" fill="#3498db" fillOpacity={0.15} stackId="1" />
                    <Area name="低估區" type="monotone" dataKey={(d) => d.riverBands[1] - d.riverBands[0]} stroke="none" fill="#2ecc71" fillOpacity={0.15} stackId="1" />
                    <Area name="合理區" type="monotone" dataKey={(d) => d.riverBands[2] - d.riverBands[1]} stroke="none" fill="#f1c40f" fillOpacity={0.15} stackId="1" />
                    <Area name="高估區" type="monotone" dataKey={(d) => d.riverBands[3] - d.riverBands[2]} stroke="none" fill="#e67e22" fillOpacity={0.15} stackId="1" />
                    <Area name="極高區" type="monotone" dataKey={(d) => d.riverBands[4] - d.riverBands[3]} stroke="none" fill="#8b0000" fillOpacity={0.15} stackId="1" />

                    <Line name="60MA" type="monotone" dataKey="ma60" stroke="#94a3b8" strokeWidth={1} dot={false} strokeDasharray="4 4" />
                    <Line name="收盤價" type="monotone" dataKey="price" stroke="#f43f5e" strokeWidth={2.5} dot={false} animationDuration={1200} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

// --- 5. Main App ---
const App = () => {
    const [input, setInput] = useState('2330');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [info, setInfo] = useState<any>(null);
    const [analysis, setAnalysis] = useState<string | null>(null);

    const handleSearch = useCallback(async (val: string) => {
        const s = formatSymbol(val);
        setLoading(true);
        setError(null);
        setAnalysis(null);
        try {
            const result = await fetchStockData(s);
            setHistory(result.history);
            setInfo(result.info);
            setInput(s);
            const aiResult = await analyzeStock(result.info, result.history[result.history.length - 1]);
            setAnalysis(aiResult);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { handleSearch(input); }, []);

    const currentPoint = history[history.length - 1];
    const currentZone = useMemo(() => {
        if (!currentPoint) return RIVER_ZONES.Unknown;
        const bands = currentPoint.riverBands;
        const p = currentPoint.price;
        if (p > bands[4]) return RIVER_ZONES.ExtremelyHigh;
        if (p > bands[3]) return RIVER_ZONES.High;
        if (p > bands[2]) return RIVER_ZONES.Fair;
        if (p > bands[1]) return RIVER_ZONES.Low;
        return RIVER_ZONES.ExtremelyLow;
    }, [currentPoint]);

    return (
        <div className="flex h-screen overflow-hidden">
            <div className="w-20 hidden md:flex flex-col items-center py-8 gap-10 bg-[#020617] border-r border-slate-900">
                <div className="p-3 bg-amber-500 rounded-2xl shadow-lg shadow-amber-500/20">
                    <TrendingUp className="text-slate-950 w-6 h-6" />
                </div>
                <div className="flex flex-col gap-8 text-slate-500">
                    <LayoutDashboard className="w-6 h-6 hover:text-white cursor-pointer transition-colors" />
                    <BarChart3 className="w-6 h-6 text-white" />
                    <Settings className="w-6 h-6 hover:text-white cursor-pointer transition-colors" />
                    <HelpCircle className="w-6 h-6 hover:text-white cursor-pointer transition-colors" />
                </div>
            </div>

            <main className="flex-1 overflow-y-auto bg-gradient-to-br from-[#020617] via-[#0f172a] to-[#020617]">
                <div className="max-w-6xl mx-auto p-6 md:p-12">
                    <header className="flex flex-col md:flex-row items-center justify-between mb-12 gap-8">
                        <div>
                            <h1 className="text-4xl font-black text-white tracking-tighter mb-2">RIVER<span className="text-amber-500">CHART</span> PRO</h1>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.3em]">Value-Based Financial Intelligence</p>
                        </div>
                        <form onSubmit={(e) => { e.preventDefault(); handleSearch(input); }} className="flex gap-3 w-full md:w-auto">
                            <div className="relative flex-grow">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input 
                                    className="w-full md:w-72 bg-slate-900 border border-slate-800 rounded-2xl py-3.5 pl-12 pr-4 focus:ring-2 focus:ring-amber-500 outline-none text-white font-medium"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="輸入代碼 (2330, 00981A)"
                                />
                            </div>
                            <button className="bg-white text-slate-950 font-black px-8 py-3.5 rounded-2xl hover:bg-amber-400 active:scale-95 transition-all shadow-xl disabled:opacity-50" disabled={loading}>
                                {loading ? "分析中..." : "即時診斷"}
                            </button>
                        </form>
                    </header>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/50 p-6 rounded-3xl mb-10 flex items-center gap-4 text-red-400 animate-pulse-subtle">
                            <AlertCircle className="w-6 h-6" /> <span className="font-bold">{error}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        <div className="lg:col-span-3 space-y-8">
                            {info && (
                                <div className="glass-panel p-8 rounded-[2rem] shadow-2xl relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 blur-[120px] -mr-40 -mt-40 rounded-full"></div>
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 relative z-10">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-4">
                                                <h2 className="text-5xl font-black text-white tracking-tighter">{info.symbol}</h2>
                                                <span className="px-3 py-1 bg-slate-800 text-slate-400 text-[10px] font-black rounded-lg uppercase tracking-widest">{info.currency}</span>
                                            </div>
                                            <p className="text-slate-500 font-bold text-lg">{info.shortName}</p>
                                        </div>
                                        <div className="text-left md:text-right">
                                            <div className="text-5xl font-mono font-black text-white tracking-tight leading-none mb-2">
                                                {info.regularMarketPrice.toLocaleString()}
                                            </div>
                                            <div className={`font-black text-xl flex items-center md:justify-end gap-2 ${info.regularMarketChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {info.regularMarketChangePercent >= 0 ? <TrendingUp className="w-6 h-6"/> : <TrendingDown className="w-6 h-6"/>}
                                                {info.regularMarketChangePercent.toFixed(2)}%
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-12">
                                        <div className="bg-slate-950/50 p-6 rounded-3xl border border-slate-800 hover:border-slate-700 transition-colors">
                                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">價值位階</p>
                                            <p className="text-lg font-black text-amber-500 flex items-center gap-2">
                                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_10px_#f59e0b]"></span>
                                                {currentZone}
                                            </p>
                                        </div>
                                        <div className="bg-slate-950/50 p-6 rounded-3xl border border-slate-800 hover:border-slate-700 transition-colors">
                                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">真實 EPS (TTM)</p>
                                            <p className="text-lg font-mono font-black text-white">{info.trailingEps || 'N/A'}</p>
                                        </div>
                                        <div className="bg-slate-950/50 p-6 rounded-3xl border border-slate-800 hover:border-slate-700 transition-colors">
                                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">本益比 PE</p>
                                            <p className="text-lg font-mono font-black text-white">{info.trailingPE ? info.trailingPE.toFixed(2) : 'N/A'}</p>
                                        </div>
                                        <div className="bg-slate-950/50 p-6 rounded-3xl border border-slate-800 hover:border-slate-700 transition-colors">
                                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">估值模型</p>
                                            <p className="text-sm font-black uppercase text-slate-400 mt-1">{info.trailingEps > 0 ? 'PE River' : 'MA River'}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {history.length > 0 ? (
                                <StockChart data={history} />
                            ) : (
                                <div className="h-[500px] flex items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl text-slate-700">
                                    <div className="flex flex-col items-center gap-6">
                                        <div className="w-12 h-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin"></div>
                                        <span className="font-black uppercase tracking-[0.4em] text-xs">Awaiting Data Core...</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-8">
                            <div className="glass-panel p-8 rounded-[2rem] shadow-2xl min-h-[450px] flex flex-col">
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="p-2.5 bg-indigo-500/20 rounded-xl">
                                        <BrainCircuit className="text-indigo-400 w-5 h-5" />
                                    </div>
                                    <h3 className="font-black text-white text-sm tracking-tight uppercase">AI 智慧診斷</h3>
                                </div>
                                <div className="flex-grow">
                                    {loading ? (
                                        <div className="flex flex-col items-center justify-center h-48 gap-4 opacity-50">
                                            <div className="flex gap-1.5">
                                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                                            </div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest">Processing Fundamentals</p>
                                        </div>
                                    ) : analysis ? (
                                        <div className="prose prose-invert prose-sm">
                                            <div className="text-slate-400 leading-relaxed text-sm whitespace-pre-line font-medium bg-slate-950/40 p-5 rounded-2xl border border-slate-800/50">
                                                {analysis}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-center p-4">
                                            <Info className="w-10 h-10 text-slate-800 mb-4" />
                                            <p className="text-slate-600 text-[10px] font-black uppercase tracking-widest leading-loose">
                                                請輸入代碼啟動 AI 投資報告
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="glass-panel p-8 rounded-[2rem] border-slate-800/30">
                                <h3 className="font-black text-white text-sm mb-6 flex items-center gap-3">
                                    <ChevronRight className="w-4 h-4 text-amber-500"/> 系統模型說明
                                </h3>
                                <ul className="space-y-5">
                                    <li className="flex gap-4 group">
                                        <span className="text-amber-500 font-bold mt-1 group-hover:scale-125 transition-transform">●</span>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">PE River 模型</p>
                                            <p className="text-xs text-slate-500 font-medium leading-relaxed">針對具有獲利能力的個股，系統優先採集「真實 EPS (TTM)」進行本益比倍數估值。</p>
                                        </div>
                                    </li>
                                    <li className="flex gap-4 group">
                                        <span className="text-slate-500 font-bold mt-1 group-hover:scale-125 transition-transform">●</span>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">MA Center 模型</p>
                                            <p className="text-xs text-slate-500 font-medium leading-relaxed">針對 ETF 或無獲利之標的，自動切換為 200MA (年線) 為價值中樞進行標準差倍數繪圖。</p>
                                        </div>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <footer className="mt-20 pt-10 border-t border-slate-900 flex flex-col md:flex-row justify-between items-center gap-6 text-slate-600 text-[10px] font-black uppercase tracking-[0.3em]">
                        <div className="flex items-center gap-3">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Node Ready: Financial Core Active
                        </div>
                        <div className="flex gap-10">
                            <span>Engine: Gemini 3 Flash</span>
                            <span>© 2024 RIVER PRO SYSTEMS</span>
                        </div>
                    </footer>
                </div>
            </main>
        </div>
    );
};

const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(<App />);
}
