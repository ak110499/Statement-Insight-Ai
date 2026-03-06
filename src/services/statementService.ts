import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const GEMINI_MODEL = "gemini-3-flash-preview";

export interface Transaction {
  date: string;
  narration: string;
  refNo: string;
  withdrawal: number;
  deposit: number;
  balance: number;
  category: string;
  group?: string;
}

export interface DetailedInsight {
  title: string;
  description: string;
  impact?: string;
  severity?: "low" | "medium" | "high";
}

export interface StatementInsights {
  summary: {
    totalDeposits: number;
    totalWithdrawals: number;
    netCashFlow: number;
    transactionCount: number;
  };
  categories: { name: string; value: number }[];
  groups: { name: string; transactions: number; total: number }[];
  anomalies: DetailedInsight[];
  recommendations: DetailedInsight[];
}

export class StatementService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  async parseStatement(text: string): Promise<{ transactions: Transaction[]; insights: StatementInsights }> {
    const response = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analyze the following bank statement OCR text.
              Statement Text:
              ${text}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: `You are a forensic-grade bank statement parser and financial analyst.
        Goal: maximize recall and precision while returning strictly valid JSON.

        Parsing protocol (follow in order):
        1. Reconstruct rows from noisy OCR by aligning likely columns: Date | Narration | Ref No | Withdrawal | Deposit | Balance.
        2. Extract EVERY transaction row exactly once. Never merge two rows into one.
        3. Monetary accuracy rules:
           - Use plain numbers only (no currency symbols/commas).
           - Amounts must be absolute non-negative values.
           - Exactly one of withdrawal or deposit should be > 0 for normal transactions.
           - If sign is ambiguous, infer using balance movement and narration.
        4. Date handling:
           - Preserve statement order.
           - Keep date text as shown if format is uncertain.
        5. Narration/ref cleanup:
           - Keep narration informative but concise.
           - refNo must be a string (empty string if unavailable).
        6. Categorization:
           - Use specific categories (e.g., Groceries, Utilities, EMI, Salary, Rent, Transfer, Cash Withdrawal, Fees, Interest).
           - Add group for repeated counterparties/merchants and use exact same names in insights.groups.
        7. Insights quality:
           - summary.transactionCount must equal transactions.length.
           - summary totals must match extracted transactions.
           - categories should represent spending distribution (withdrawals).
           - anomalies should be evidence-based (spikes, duplicate debits, unusual fees, balance drops).
           - recommendations should be actionable and tied to detected patterns.
        8. If OCR is partial, still output best-effort extraction and avoid fabricating unsupported values.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  narration: { type: Type.STRING },
                  refNo: { type: Type.STRING },
                  withdrawal: { type: Type.NUMBER },
                  deposit: { type: Type.NUMBER },
                  balance: { type: Type.NUMBER },
                  category: { type: Type.STRING },
                  group: { type: Type.STRING },
                },
                required: ["date", "narration", "refNo", "withdrawal", "deposit", "balance", "category"],
              },
            },
            insights: {
              type: Type.OBJECT,
              properties: {
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    totalDeposits: { type: Type.NUMBER },
                    totalWithdrawals: { type: Type.NUMBER },
                    netCashFlow: { type: Type.NUMBER },
                    transactionCount: { type: Type.NUMBER },
                  },
                },
                categories: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      value: { type: Type.NUMBER },
                    },
                  },
                },
                groups: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      transactions: { type: Type.NUMBER },
                      total: { type: Type.NUMBER },
                    },
                  },
                },
                anomalies: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      description: { type: Type.STRING },
                      impact: { type: Type.STRING },
                      severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
                    },
                    required: ["title", "description", "severity"],
                  },
                },
                recommendations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      description: { type: Type.STRING },
                      impact: { type: Type.STRING },
                      severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
                    },
                    required: ["title", "description", "severity"],
                  },
                },
              },
            },
          },
        },
      },
    });

    try {
      const parsed = JSON.parse(response.text || "{}");
      return this.normalizeResult(parsed);
    } catch (e) {
      console.error("Failed to parse AI response", e);
      throw new Error("Failed to analyze statement data.");
    }
  }

  async askQuestion(transactions: Transaction[], question: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Based on these bank transactions, answer the following question: "${question}"
              
              Transactions:
              ${JSON.stringify(transactions.slice(0, 100))} ... (showing first 100)`,
            },
          ],
        },
      ],
    });

    return response.text || "I couldn't find an answer to that.";
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[^\d.-]/g, "");
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private normalizeResult(raw: any): { transactions: Transaction[]; insights: StatementInsights } {
    const rawTransactions = Array.isArray(raw?.transactions) ? raw.transactions : [];
    const transactions: Transaction[] = rawTransactions.map((tx: any) => {
      const withdrawal = Math.max(0, this.toNumber(tx?.withdrawal));
      const deposit = Math.max(0, this.toNumber(tx?.deposit));
      const balance = this.toNumber(tx?.balance);

      return {
        date: String(tx?.date ?? "").trim(),
        narration: String(tx?.narration ?? "").trim(),
        refNo: String(tx?.refNo ?? "").trim(),
        withdrawal,
        deposit,
        balance,
        category: String(tx?.category ?? "Uncategorized").trim() || "Uncategorized",
        group: tx?.group ? String(tx.group).trim() : undefined,
      };
    });

    const totalDeposits = transactions.reduce((sum, tx) => sum + tx.deposit, 0);
    const totalWithdrawals = transactions.reduce((sum, tx) => sum + tx.withdrawal, 0);
    const netCashFlow = totalDeposits - totalWithdrawals;

    const categoriesMap = new Map<string, number>();
    transactions.forEach((tx) => {
      if (tx.withdrawal > 0) {
        categoriesMap.set(tx.category, (categoriesMap.get(tx.category) || 0) + tx.withdrawal);
      }
    });

    const groupsMap = new Map<string, { transactions: number; total: number }>();
    transactions.forEach((tx) => {
      if (!tx.group) return;
      const current = groupsMap.get(tx.group) || { transactions: 0, total: 0 };
      current.transactions += 1;
      current.total += tx.deposit - tx.withdrawal;
      groupsMap.set(tx.group, current);
    });

    const normalizeInsight = (item: any): DetailedInsight => ({
      title: String(item?.title ?? "Untitled insight").trim(),
      description: String(item?.description ?? "").trim(),
      impact: item?.impact ? String(item.impact).trim() : undefined,
      severity: ["low", "medium", "high"].includes(item?.severity) ? item.severity : "medium",
    });

    return {
      transactions,
      insights: {
        summary: {
          totalDeposits,
          totalWithdrawals,
          netCashFlow,
          transactionCount: transactions.length,
        },
        categories: Array.from(categoriesMap.entries()).map(([name, value]) => ({ name, value })),
        groups: Array.from(groupsMap.entries()).map(([name, data]) => ({
          name,
          transactions: data.transactions,
          total: data.total,
        })),
        anomalies: Array.isArray(raw?.insights?.anomalies) ? raw.insights.anomalies.map(normalizeInsight) : [],
        recommendations: Array.isArray(raw?.insights?.recommendations)
          ? raw.insights.recommendations.map(normalizeInsight)
          : [],
      },
    };
  }
}
