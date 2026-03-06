/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from "react";
import { 
  LayoutDashboard, 
  Upload, 
  FileText, 
  TrendingUp, 
  TrendingDown, 
  PieChart as PieChartIcon, 
  AlertCircle, 
  Search,
  ChevronRight,
  MessageSquare,
  ArrowUpRight,
  ArrowDownLeft,
  Filter,
  Group as GroupIcon,
  Download,
  FileSpreadsheet,
  FileJson,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Settings2,
  Plus,
  Trash2,
  Edit2,
  Check,
  X as CloseIcon,
  Save,
  FolderOpen,
  GitMerge,
  History
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line
} from "recharts";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import * as pdfjs from "pdfjs-dist";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { StatementService, type Transaction, type StatementInsights, type DetailedInsight } from "./services/statementService";
import { cn, formatCurrency } from "./lib/utils";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

export default function App() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [data, setData] = useState<{ transactions: Transaction[]; insights: StatementInsights } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: 'date' | 'amount' | 'category'; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' });
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{ oldName: string; newName: string } | null>(null);
  const [mergingCategory, setMergingCategory] = useState<{ source: string; target: string } | null>(null);
  const [savedAnalyses, setSavedAnalyses] = useState<{ id: string; name: string; date: string }[]>(() => {
    const saved = localStorage.getItem('statement_analyses_index');
    return saved ? JSON.parse(saved) : [];
  });
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const maxGroupTotal = useMemo(() => {
    if (!data) return 0;
    return Math.max(...data.insights.groups.map(g => Math.abs(g.total)));
  }, [data]);

  const statementService = useMemo(() => new StatementService(), []);

  const extractTextFromPdf = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      fullText += pageText + "\n";
    }
    return fullText;
  };

  const extractTextFromExcel = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer);
    let fullText = "";
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      fullText += `Sheet: ${sheetName}\n${csv}\n\n`;
    });
    return fullText;
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      let text = "";
      const fileType = file.name.split('.').pop()?.toLowerCase();

      if (fileType === 'pdf') {
        text = await extractTextFromPdf(file);
      } else if (fileType === 'xlsx' || fileType === 'xls') {
        text = await extractTextFromExcel(file);
      } else {
        text = await file.text();
      }

      if (!text.trim()) {
        throw new Error("The file seems to be empty or unreadable.");
      }

      const result = await statementService.parseStatement(text);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze the statement. Please ensure it's a valid format.");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [statementService]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 
      'text/plain': ['.txt'], 
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    multiple: false
  });

  const handleManualPaste = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get("ocrText") as string;
    if (!text) return;

    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await statementService.parseStatement(text);
      setData(result);
    } catch (err) {
      setError("Failed to analyze the statement text.");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAskQuestion = async () => {
    if (!data || !chatQuestion) return;
    setIsAsking(true);
    try {
      const answer = await statementService.askQuestion(data.transactions, chatQuestion);
      setChatAnswer(answer);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAsking(false);
    }
  };

  const exportToCSV = () => {
    if (!data) return;
    const worksheet = XLSX.utils.json_to_sheet(filteredTransactions);
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `transactions_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToXLSX = () => {
    if (!data) return;
    const worksheet = XLSX.utils.json_to_sheet(filteredTransactions);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    XLSX.writeFile(workbook, `transactions_${new Date().getTime()}.xlsx`);
  };

  const exportToPDF = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.text("Transaction Statement", 14, 15);
    const tableData = filteredTransactions.map(t => [
      t.date,
      t.narration,
      t.category,
      t.withdrawal > 0 ? `-${t.withdrawal}` : `+${t.deposit}`,
      t.balance
    ]);
    autoTable(doc, {
      head: [['Date', 'Narration', 'Category', 'Amount', 'Balance']],
      body: tableData,
      startY: 20,
    });
    doc.save(`transactions_${new Date().getTime()}.pdf`);
  };

  const handleSort = (key: 'date' | 'amount' | 'category') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleRenameCategory = (oldName: string, newName: string) => {
    if (!data || !newName.trim() || oldName === newName) return;

    const updatedTransactions = data.transactions.map(t => 
      t.category === oldName ? { ...t, category: newName } : t
    );

    // Recalculate insights
    const categoriesMap = new Map<string, number>();
    updatedTransactions.forEach(t => {
      const amount = t.withdrawal || 0;
      if (amount > 0) {
        categoriesMap.set(t.category, (categoriesMap.get(t.category) || 0) + amount);
      }
    });

    const updatedCategories = Array.from(categoriesMap.entries()).map(([name, value]) => ({ name, value }));

    setData({
      ...data,
      transactions: updatedTransactions,
      insights: {
        ...data.insights,
        categories: updatedCategories
      }
    });
    setEditingCategory(null);
  };

  const handleAddCategory = (name: string) => {
    if (!data || !name.trim()) return;
    if (data.insights.categories.find(c => c.name === name)) return;

    setData({
      ...data,
      insights: {
        ...data.insights,
        categories: [...data.insights.categories, { name, value: 0 }]
      }
    });
  };

  const handleMergeCategories = (source: string, target: string) => {
    if (!data || source === target) return;
    
    const updatedTransactions = data.transactions.map(t => 
      t.category === source ? { ...t, category: target } : t
    );

    // Recalculate insights
    const categoriesMap = new Map<string, number>();
    updatedTransactions.forEach(t => {
      const amount = t.withdrawal || 0;
      if (amount > 0) {
        categoriesMap.set(t.category, (categoriesMap.get(t.category) || 0) + amount);
      }
    });

    const updatedCategories = Array.from(categoriesMap.entries()).map(([name, value]) => ({ name, value }));

    setData({
      ...data,
      transactions: updatedTransactions,
      insights: {
        ...data.insights,
        categories: updatedCategories
      }
    });
    setMergingCategory(null);
  };

  const saveCurrentAnalysis = (name: string) => {
    if (!data) return;
    const id = `analysis_${Date.now()}`;
    const analysisData = {
      data,
      filter,
      selectedGroup,
      sortConfig,
      timestamp: new Date().toISOString()
    };
    
    localStorage.setItem(id, JSON.stringify(analysisData));
    
    const newIndex = [{ id, name, date: new Date().toLocaleString() }, ...savedAnalyses];
    setSavedAnalyses(newIndex);
    localStorage.setItem('statement_analyses_index', JSON.stringify(newIndex));
  };

  const loadAnalysis = (id: string) => {
    const saved = localStorage.getItem(id);
    if (saved) {
      const { data: savedData, filter: savedFilter, selectedGroup: savedGroup, sortConfig: savedSort } = JSON.parse(saved);
      setData(savedData);
      setFilter(savedFilter || "");
      setSelectedGroup(savedGroup || null);
      setSortConfig(savedSort || { key: 'date', direction: 'desc' });
      setIsHistoryOpen(false);
    }
  };

  const deleteAnalysis = (id: string) => {
    localStorage.removeItem(id);
    const newIndex = savedAnalyses.filter(a => a.id !== id);
    setSavedAnalyses(newIndex);
    localStorage.setItem('statement_analyses_index', JSON.stringify(newIndex));
  };

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    const filtered = data.transactions.filter(t => {
      const matchesSearch = t.narration.toLowerCase().includes(filter.toLowerCase()) ||
        t.category.toLowerCase().includes(filter.toLowerCase()) ||
        t.group?.toLowerCase().includes(filter.toLowerCase());
      
      const matchesGroup = !selectedGroup || 
        t.group === selectedGroup || 
        t.narration.toLowerCase().includes(selectedGroup.toLowerCase());
      
      return matchesSearch && matchesGroup;
    });

    return [...filtered].sort((a, b) => {
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      
      if (sortConfig.key === 'date') {
        return (new Date(a.date).getTime() - new Date(b.date).getTime()) * direction;
      }
      if (sortConfig.key === 'amount') {
        const valA = a.withdrawal || a.deposit || 0;
        const valB = b.withdrawal || b.deposit || 0;
        return (valA - valB) * direction;
      }
      if (sortConfig.key === 'category') {
        return a.category.localeCompare(b.category) * direction;
      }
      return 0;
    });
  }, [data, filter, selectedGroup, sortConfig]);

  return (
    <div className="min-h-screen bg-[#F5F5F5] font-sans text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <LayoutDashboard className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">StatementInsight AI</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              <History className="w-4 h-4" />
              History
            </button>
            {data && (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    const name = prompt("Enter a name for this analysis:", `Analysis ${new Date().toLocaleDateString()}`);
                    if (name) saveCurrentAnalysis(name);
                  }}
                  className="flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save
                </button>
                <button 
                  onClick={() => setData(null)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
                >
                  Upload New
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {!data ? (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold">Analyze your bank statement</h2>
                <p className="text-slate-500">Upload your statement text or paste the OCR content to get instant financial insights.</p>
              </div>

              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer",
                  isDragActive ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-emerald-400 bg-white"
                )}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-slate-100 p-4 rounded-full">
                    <Upload className="w-8 h-8 text-slate-400" />
                  </div>
                  <div>
                    <p className="font-medium text-lg">Drag & drop statement file here</p>
                    <p className="text-sm text-slate-400">Supports .pdf, .xlsx, .csv, .txt</p>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#F5F5F5] px-2 text-slate-500">Or paste OCR text</span>
                </div>
              </div>

              <form onSubmit={handleManualPaste} className="space-y-4">
                <textarea 
                  name="ocrText"
                  placeholder="Paste your bank statement text here..."
                  className="w-full h-64 p-4 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all font-mono text-sm"
                  required
                />
                <button 
                  type="submit"
                  disabled={isAnalyzing}
                  className="w-full bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing Statement...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5" />
                      Analyze Statement
                    </>
                  )}
                </button>
              </form>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard 
                  title="Total Deposits" 
                  value={formatCurrency(data.insights.summary.totalDeposits)} 
                  icon={<TrendingUp className="text-emerald-600" />}
                  trend="Income"
                />
                <SummaryCard 
                  title="Total Withdrawals" 
                  value={formatCurrency(data.insights.summary.totalWithdrawals)} 
                  icon={<TrendingDown className="text-rose-600" />}
                  trend="Expenses"
                />
                <SummaryCard 
                  title="Net Cash Flow" 
                  value={formatCurrency(data.insights.summary.netCashFlow)} 
                  icon={<PieChartIcon className="text-blue-600" />}
                  trend={data.insights.summary.netCashFlow >= 0 ? "Profit" : "Loss"}
                  trendColor={data.insights.summary.netCashFlow >= 0 ? "text-emerald-600" : "text-rose-600"}
                />
                <SummaryCard 
                  title="Transactions" 
                  value={data.insights.summary.transactionCount.toString()} 
                  icon={<FileText className="text-slate-600" />}
                  trend="Total Count"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Spending by Category */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6">Spending Analysis</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.insights.categories}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Category Distribution */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative group">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold">Expense Categories</h3>
                    <button 
                      onClick={() => setIsCategoryModalOpen(true)}
                      className="p-2 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-all"
                      title="Manage Categories"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.insights.categories}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {data.insights.categories.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 space-y-2">
                    {data.insights.categories.slice(0, 4).map((cat, i) => (
                      <div key={cat.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-slate-600">{cat.name}</span>
                        </div>
                        <span className="font-medium">{formatCurrency(cat.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* AI Insights & Recommendations */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg">
                    <div className="flex items-center gap-2 mb-6">
                      <AlertCircle className="text-emerald-400 w-5 h-5" />
                      <h3 className="font-semibold">AI Observations</h3>
                    </div>
                    <div className="space-y-4">
                      {data.insights.anomalies.map((anomaly, i) => (
                        <div key={i} className="space-y-2 p-4 rounded-xl bg-white/5 border border-white/10 transition-all hover:bg-white/10">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-medium text-sm leading-tight text-emerald-400">{anomaly.title}</h4>
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider",
                              anomaly.severity === 'high' ? "bg-red-500/20 text-red-400" :
                              anomaly.severity === 'medium' ? "bg-orange-500/20 text-orange-400" :
                              "bg-yellow-500/20 text-yellow-400"
                            )}>
                              {anomaly.severity}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed">{anomaly.description}</p>
                          {anomaly.impact && (
                            <div className="flex items-center gap-1.5 pt-2 mt-2 border-t border-white/5">
                              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-tight">Impact:</span>
                              <span className="text-[10px] text-slate-300 italic">{anomaly.impact}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-6">
                      <TrendingUp className="text-blue-600 w-5 h-5" />
                      <h3 className="font-semibold text-slate-900">Recommendations</h3>
                    </div>
                    <div className="space-y-4">
                      {data.insights.recommendations.map((rec, i) => (
                        <div key={i} className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-100 transition-all hover:bg-slate-100">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-medium text-sm leading-tight text-blue-600">{rec.title}</h4>
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider",
                              rec.severity === 'high' ? "bg-emerald-100 text-emerald-700" :
                              rec.severity === 'medium' ? "bg-blue-100 text-blue-700" :
                              "bg-slate-200 text-slate-600"
                            )}>
                              {rec.severity}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">{rec.description}</p>
                          {rec.impact && (
                            <div className="flex items-center gap-1.5 pt-2 mt-2 border-t border-slate-200">
                              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tight">Benefit:</span>
                              <span className="text-[10px] text-slate-600 italic">{rec.impact}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Grouped Entity Summary */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <GroupIcon className="text-purple-600 w-5 h-5" />
                      <h3 className="font-semibold">Top Grouped Entities</h3>
                    </div>
                    <div className="space-y-2">
                      {data.insights.groups.slice(0, 5).map((group, i) => (
                        <button 
                          key={i} 
                          onClick={() => setSelectedGroup(selectedGroup === group.name ? null : group.name)}
                          className={cn(
                            "w-full flex flex-col p-3 rounded-xl transition-all text-left group border",
                            selectedGroup === group.name 
                              ? "bg-purple-50 border-purple-200 shadow-sm" 
                              : "hover:bg-slate-50 border-transparent"
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium truncate max-w-[150px]">{group.name}</p>
                              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{group.transactions} transactions</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <p className={cn(
                                "text-sm font-semibold",
                                group.total < 0 ? "text-rose-600" : "text-emerald-600"
                              )}>
                                {formatCurrency(Math.abs(group.total))}
                              </p>
                              <ChevronRight className={cn(
                                "w-4 h-4 text-slate-300 transition-transform",
                                selectedGroup === group.name && "rotate-90 text-purple-500"
                              )} />
                            </div>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${(Math.abs(group.total) / maxGroupTotal) * 100}%` }}
                              className={cn(
                                "h-full rounded-full",
                                group.total < 0 ? "bg-rose-400" : "bg-emerald-400"
                              )}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Transaction Table */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-lg font-semibold">Transactions</h3>
                      {selectedGroup && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Group Filter:</span>
                          <button 
                            onClick={() => setSelectedGroup(null)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100 hover:bg-purple-100 transition-colors"
                          >
                            {selectedGroup}
                            <Search className="w-3 h-3 rotate-45" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="relative flex-1 max-w-sm">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="Search narration, category..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={exportToCSV}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-all text-slate-600"
                        title="Export CSV"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={exportToXLSX}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-all text-emerald-600"
                        title="Export XLSX"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={exportToPDF}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-all text-rose-600"
                        title="Export PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto flex-1">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th 
                            className="px-6 py-4 font-semibold cursor-pointer hover:bg-slate-100 transition-colors"
                            onClick={() => handleSort('date')}
                          >
                            <div className="flex items-center gap-1">
                              Date
                              {sortConfig.key === 'date' ? (
                                sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                              ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                            </div>
                          </th>
                          <th className="px-6 py-4 font-semibold">Narration</th>
                          <th 
                            className="px-6 py-4 font-semibold cursor-pointer hover:bg-slate-100 transition-colors"
                            onClick={() => handleSort('category')}
                          >
                            <div className="flex items-center gap-1">
                              Category
                              {sortConfig.key === 'category' ? (
                                sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                              ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                            </div>
                          </th>
                          <th 
                            className="px-6 py-4 font-semibold text-right cursor-pointer hover:bg-slate-100 transition-colors"
                            onClick={() => handleSort('amount')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Amount
                              {sortConfig.key === 'amount' ? (
                                sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                              ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTransactions.map((t, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">{t.date}</td>
                            <td className="px-6 py-4">
                              <div className="space-y-0.5">
                                <p className="text-sm font-medium text-slate-900 leading-tight">{t.narration}</p>
                                {t.group && (
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md">
                                    <GroupIcon className="w-2.5 h-2.5" />
                                    {t.group}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                {t.category}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right whitespace-nowrap">
                              <div className="flex flex-col items-end">
                                {t.withdrawal > 0 ? (
                                  <span className="text-sm font-semibold text-rose-600">-{formatCurrency(t.withdrawal)}</span>
                                ) : (
                                  <span className="text-sm font-semibold text-emerald-600">+{formatCurrency(t.deposit)}</span>
                                )}
                                <span className="text-[10px] text-slate-400">Bal: {formatCurrency(t.balance)}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* AI Chat Interface */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center gap-2">
                  <MessageSquare className="text-emerald-600 w-5 h-5" />
                  <h3 className="font-semibold">Ask your statement</h3>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="e.g., How much did I spend on fuel last month?"
                      value={chatQuestion}
                      onChange={(e) => setChatQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAskQuestion()}
                      className="flex-1 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all text-sm"
                    />
                    <button 
                      onClick={handleAskQuestion}
                      disabled={isAsking || !chatQuestion}
                      className="bg-slate-900 text-white px-6 py-2 rounded-xl font-medium hover:bg-slate-800 disabled:opacity-50 transition-all"
                    >
                      {isAsking ? "Thinking..." : "Ask"}
                    </button>
                  </div>
                  {chatAnswer && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-slate-50 p-4 rounded-xl border border-slate-100"
                    >
                      <div className="prose prose-sm max-w-none text-slate-700">
                        <ReactMarkdown>{chatAnswer}</ReactMarkdown>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History Modal */}
        <AnimatePresence>
          {isHistoryOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-slate-600" />
                    <h3 className="text-lg font-semibold">Saved Analyses</h3>
                  </div>
                  <button onClick={() => setIsHistoryOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <CloseIcon className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
                  {savedAnalyses.length === 0 ? (
                    <div className="text-center py-8 space-y-2">
                      <FolderOpen className="w-12 h-12 text-slate-200 mx-auto" />
                      <p className="text-slate-500">No saved analyses found.</p>
                    </div>
                  ) : (
                    savedAnalyses.map((analysis) => (
                      <div key={analysis.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-all group">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{analysis.name}</p>
                          <p className="text-xs text-slate-400">{analysis.date}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => loadAnalysis(analysis.id)}
                            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-all"
                          >
                            Load
                          </button>
                          <button 
                            onClick={() => deleteAnalysis(analysis.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Category Management Modal */}
        <AnimatePresence>
          {isCategoryModalOpen && data && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Manage Categories</h3>
                  <button onClick={() => setIsCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <CloseIcon className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                  {data.insights.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between group">
                      {editingCategory?.oldName === cat.name ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input 
                            autoFocus
                            className="flex-1 px-2 py-1 text-sm border rounded-md outline-none focus:ring-2 focus:ring-emerald-500"
                            value={editingCategory.newName}
                            onChange={(e) => setEditingCategory({ ...editingCategory, newName: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameCategory(cat.name, editingCategory.newName)}
                          />
                          <button onClick={() => handleRenameCategory(cat.name, editingCategory.newName)} className="text-emerald-600">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingCategory(null)} className="text-slate-400">
                            <CloseIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm text-slate-600">{cat.name}</span>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => setMergingCategory({ source: cat.name, target: "" })}
                              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-purple-600"
                              title="Merge Category"
                            >
                              <GitMerge className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => setEditingCategory({ oldName: cat.name, newName: cat.name })}
                              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600"
                              title="Rename Category"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Merge UI */}
                {mergingCategory && (
                  <div className="p-4 bg-purple-50 border-t border-purple-100 space-y-3">
                    <p className="text-xs font-medium text-purple-700">Merge <span className="font-bold">{mergingCategory.source}</span> into:</p>
                    <div className="flex gap-2">
                      <select 
                        className="flex-1 px-2 py-1.5 text-sm border border-purple-200 rounded-xl outline-none bg-white"
                        value={mergingCategory.target}
                        onChange={(e) => setMergingCategory({ ...mergingCategory, target: e.target.value })}
                      >
                        <option value="">Select target category...</option>
                        {data.insights.categories
                          .filter(c => c.name !== mergingCategory.source)
                          .map(c => <option key={c.name} value={c.name}>{c.name}</option>)
                        }
                      </select>
                      <button 
                        disabled={!mergingCategory.target}
                        onClick={() => handleMergeCategories(mergingCategory.source, mergingCategory.target)}
                        className="bg-purple-600 text-white px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                      >
                        Merge
                      </button>
                      <button 
                        onClick={() => setMergingCategory(null)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <CloseIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-slate-50 border-t border-slate-100">
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem('newCat') as HTMLInputElement;
                      handleAddCategory(input.value);
                      input.value = '';
                    }}
                    className="flex gap-2"
                  >
                    <input 
                      name="newCat"
                      placeholder="Add new category..."
                      className="flex-1 px-3 py-2 text-sm border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button type="submit" className="bg-slate-900 text-white p-2 rounded-xl hover:bg-slate-800">
                      <Plus className="w-5 h-5" />
                    </button>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SummaryCard({ title, value, icon, trend, trendColor = "text-slate-500" }: { title: string; value: string; icon: React.ReactNode; trend: string; trendColor?: string }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="bg-slate-50 p-2 rounded-lg">
          {icon}
        </div>
        <span className={cn("text-xs font-medium px-2 py-1 rounded-full bg-slate-100", trendColor)}>
          {trend}
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
      </div>
    </div>
  );
}
