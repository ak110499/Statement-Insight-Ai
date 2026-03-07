import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const GEMINI_MODEL = "gemini-3-flash-preview";

export interface Transaction {
  id: string;
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
    // Step 1: Extract transactions using the high-precision data parser prompt
    const extractionResponse = await this.ai.models.generateContent({
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
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        systemInstruction: `## Role
You are the high-precision data parser for 'StatementInsight AI'. Your task is to extract bank data from a CSV/XLS format into a strict JSON array.

## Column Mapping Rules (Crucial)
1. 'Date' is in Column 1.
2. 'Narration' is in Column 2. Capture the FULL text; do not truncate or rephrase.
3. 'Chq./Ref.No.' is in Column 3. Include this in your internal analysis to identify unique transactions.
4. 'Value Dt' is in Column 4.
5. 'Withdrawal Amt.' is in Column 5.
6. 'Deposit Amt.' is in Column 6.
7. 'Closing Balance' is in Column 7.

## Processing Instructions
- STARTING POINT: Begin extraction only from the row containing actual transaction data (after the headers).
- NO SUMMARIZATION: Every single row with an amount must be its own object in the JSON array.
- ESCAPE CHARACTERS: Bank narrations often contain slashes (/), dashes (-), and quotes ("). You MUST escape these characters to prevent JSON "Expected ',' or ']'" errors.
- CLEAN NUMBERS: Remove all commas from currency values (e.g., "4,864.00" becomes 4864.00) before placing them in the JSON.

## Output Format
Return ONLY a valid JSON array of objects:
[
  {
    "date": "DD/MM/YY",
    "narration": "Full text from column 2",
    "reference": "Text from column 3",
    "amount": 0.00,
    "type": "debit" | "credit",
    "balance": 0.00
  }
]`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              narration: { type: Type.STRING },
              reference: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              type: { type: Type.STRING, enum: ["debit", "credit"] },
              balance: { type: Type.NUMBER },
            },
            required: ["date", "narration", "reference", "amount", "type", "balance"],
          },
        },
      },
    });

    let extractedTransactions: any[] = [];
    try {
      let jsonText = extractionResponse.text || "[]";
      const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonText = match[1];
      } else {
        const start = jsonText.indexOf('[');
        const end = jsonText.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
          jsonText = jsonText.substring(start, end + 1);
        }
      }
      extractedTransactions = JSON.parse(jsonText);
    } catch (e) {
      console.error("Failed to parse extraction response", e);
      throw new Error("Failed to extract statement data.");
    }

    // Map to internal Transaction format
    let transactions: Transaction[] = extractedTransactions.map((item: any, index: number) => {
      const isDebit = item.type === "debit";
      return {
        id: `tx-${Date.now()}-${index}`,
        date: item.date,
        narration: item.narration,
        refNo: item.reference,
        withdrawal: isDebit ? item.amount : 0,
        deposit: isDebit ? 0 : item.amount,
        balance: item.balance,
        category: "Uncategorized",
        group: undefined
      };
    });

    // Step 2: Generate Insights, Categories, and Groups
    const insightsResponse = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analyze these transactions and provide categories, groups, and insights.
              Transactions:
              ${JSON.stringify(transactions)}`,
            },
          ],
        },
      ],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        systemInstruction: `You are a meticulous financial data analyst.
        Task: Analyze the provided transactions.
        
        Strict Rules:
        1. Categorize each transaction logically (e.g., Food, Salary, Rent). Return an array of updates mapped to transaction IDs.
        2. Grouping is CRITICAL: Group recurring vendors or entities accurately. For example, if there are 12 transactions for "Haier Appliances", all 12 must have the exact same "group" value. Ensure the "group" field matches the names in "insights.groups" exactly. Be highly sensitive to variations in vendor names and group them under a single unified name.
        3. Provide accurate summary totals (deposits, withdrawals, net flow).
        4. Identify anomalies (unusual spikes, double charges) and recommendations.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactionUpdates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  category: { type: Type.STRING },
                  group: { type: Type.STRING },
                },
                required: ["id", "category"],
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
              required: ["summary", "categories", "groups", "anomalies", "recommendations"],
            },
          },
        },
      },
    });

    try {
      let jsonText = insightsResponse.text || "{}";
      const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonText = match[1];
      } else {
        const start = jsonText.indexOf('{');
        const end = jsonText.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          jsonText = jsonText.substring(start, end + 1);
        }
      }
      const result = JSON.parse(jsonText);
      
      // Apply updates to transactions
      if (result.transactionUpdates) {
        const updateMap = new Map<string, any>(result.transactionUpdates.map((u: any) => [u.id, u]));
        transactions = transactions.map(t => {
          const update = updateMap.get(t.id);
          if (update) {
            return {
              ...t,
              category: update.category || t.category,
              group: update.group || t.group
            };
          }
          return t;
        });
      }

      // Ensure defaults to prevent crashes
      if (!result.insights) {
        result.insights = {
          summary: { totalDeposits: 0, totalWithdrawals: 0, netCashFlow: 0, transactionCount: 0 },
          categories: [],
          groups: [],
          anomalies: [],
          recommendations: []
        };
      } else {
        if (!result.insights.summary) result.insights.summary = { totalDeposits: 0, totalWithdrawals: 0, netCashFlow: 0, transactionCount: 0 };
        if (!result.insights.categories) result.insights.categories = [];
        if (!result.insights.groups) result.insights.groups = [];
        if (!result.insights.anomalies) result.insights.anomalies = [];
        if (!result.insights.recommendations) result.insights.recommendations = [];
      }
      
      return { transactions, insights: result.insights };
    } catch (e) {
      console.error("Failed to parse insights response", e);
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
