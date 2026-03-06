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
        systemInstruction: `You are a meticulous financial data analyst. Your primary goal is 100% data integrity.
        Task: Extract EVERY single transaction from the provided bank statement OCR text.
        
        Strict Rules:
        1. DO NOT SKIP any transactions. Every line item must be captured.
        2. Extract: Date, Narration, Ref No, Withdrawal, Deposit, and Balance.
        3. Categorize each transaction logically (e.g., Food, Salary, Rent).
        4. Group recurring vendors or entities (ensure "group" field matches "insights.groups" names exactly).
        5. Provide accurate summary totals (deposits, withdrawals, net flow).
        6. Identify anomalies (unusual spikes, double charges) and recommendations.
        7. If OCR text is messy, use context to reconstruct the transaction details correctly.`,
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
                required: ["date", "narration", "withdrawal", "deposit", "balance", "category"],
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
      return JSON.parse(response.text || "{}");
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
}
