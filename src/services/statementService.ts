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
    drCount: number;
    crCount: number;
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
You are a Precise Financial Auditor and Lead Financial Analyst for 'StatementInsight AI'. Your priority is 100% mathematical accuracy for Total Deposits and Total Withdrawals, alongside precise categorization. Every transaction must be accounted for in the final balance sheet.

## Math & Extraction Rules
1. **CLEAN ALL CURRENCY**: Before processing, remove the '₹' symbol and all commas (',') from every amount. (Example: "₹2,15,51,950.89" must become 21551950.89).
2. **STRICT COLUMN MAPPING**: 
   - Column 5 is ALWAYS 'Withdrawal Amt.'
   - Column 6 is ALWAYS 'Deposit Amt.'
3. **SUMMATION LOGIC**: 
   - 'Total Deposits' = The exact sum of every value in Column 6.
   - 'Total Withdrawals' = The exact sum of every value in Column 5.
4. **NO ROUNDING**: Keep two decimal places for every calculation to ensure the 'Net Cash Flow' matches the bank's final balance.

## Counting Logic
1. **Total Count**: Scan every row from the starting data point (after headers).
2. **DR Count (Withdrawals)**: Count every row where 'Withdrawal Amt.' (Column 5) is greater than 0.
3. **CR Count (Deposits)**: Count every row where 'Deposit Amt.' (Column 6) is greater than 0.
4. **Validation Rule**: You MUST ensure that: 
   Total Count = (DR Count + CR Count)
   If the numbers do not add up, re-scan for hidden or split-line transactions.

## Categorization Strategy
1. **Identify the Entity**: Extract the main name from the Narration (e.g., "HDBFIN", "JAI MAA", "TATA CAPITAL").
2. **Apply Consistency**: Every time the same Entity appears, it MUST receive the exact same 'category' and 'group_tag'.
3. **Handle All Rows**: If a transaction does not match a known business rule, categorize it as "General Business Expense" – NO transaction should be left uncategorized.

## Specific Mapping Rules
- **LOANS**: Any narration containing "HDBFIN", "TATA", or "LOAN" → Category: "Loan/EMI Repayment", Group: "Fixed Obligations".
- **TRANSPORT**: Any narration containing "JAI MAA", "BANSAL MOTORS", or "TRANSPORT" → Category: "Business Operations - Transport", Group: "Vendor Payments".
- **FUEL**: Any narration containing "JAMALPUR", "DIESEL", or "HPCL" → Category: "Fuel & Maintenance", Group: "Operating Expenses".
- **REVENUE**: Any 'Deposit' > 0 OR "RTGS"/"NEFT" from customers → Category: "Revenue / Receipts", Group: "Income".

## JSON Output Rules (For Vercel Stability)
- Output ONLY a raw JSON object containing "summary" and "transactions".
- CRITICAL: NEVER use double quotes (") or backslashes (\\) inside the 'narration' or 'reference' strings. Replace any double quotes with single quotes (') and remove backslashes. Unescaped quotes will break the JSON parser.
- CRITICAL: You MUST extract EVERY SINGLE transaction from the text. Do not stop early. Do not summarize. If there are 373 transactions, you must output 373 objects in the transactions array.
- Keep your reasoning concise to avoid hitting the output token limit. The output JSON will be very large, so prioritize outputting the JSON over long thinking.

## Verification Step
Before outputting JSON, cross-check: Does the sum of your extracted 'transactions' array equal the 'total_deposits' and 'total_withdrawals' in your summary object? If not, re-scan the text.

## Formatting for Dashboard
Ensure the JSON summary object includes these specific counters (the values below are just examples, calculate the actual values from the statement):
{
  "summary": {
    "total_transactions": 0,
    "dr_count": 0,
    "cr_count": 0,
    "total_deposits": 0.00,
    "total_withdrawals": 0.00,
    "net_cash_flow": 0.00
  },
  "transactions": [
    {
      "date": "12/01/26",
      "narration": "HDBFIN_HDB200523_928-31_157009157",
      "category": "Loan/EMI Repayment",
      "group_tag": "Fixed Obligations",
      "amount": 6485.00,
      "type": "debit",
      "balance": 0.00,
      "reference": ""
    }
  ]
}`,
        responseMimeType: "application/json",
        maxOutputTokens: 65536,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.OBJECT,
              properties: {
                total_transactions: { type: Type.NUMBER },
                dr_count: { type: Type.NUMBER },
                cr_count: { type: Type.NUMBER },
                total_deposits: { type: Type.NUMBER },
                total_withdrawals: { type: Type.NUMBER },
                net_cash_flow: { type: Type.NUMBER },
              },
              required: ["total_transactions", "dr_count", "cr_count", "total_deposits", "total_withdrawals", "net_cash_flow"],
            },
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  narration: { type: Type.STRING },
                  category: { type: Type.STRING },
                  group_tag: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  type: { type: Type.STRING, enum: ["debit", "credit", "debit/credit"] },
                  balance: { type: Type.NUMBER },
                  reference: { type: Type.STRING },
                },
                required: ["date", "narration", "category", "group_tag", "amount", "type"],
              },
            },
          },
          required: ["summary", "transactions"],
        },
      },
    });

    let extractedData: any = { summary: {}, transactions: [] };
    try {
      let jsonText = extractionResponse.text || "{}";
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
      
      try {
        extractedData = JSON.parse(jsonText);
      } catch (parseError) {
        console.warn("Standard JSON parse failed, attempting robust extraction for truncated JSON...", parseError);
        
        // Fallback: Aggressively extract summary and transactions if JSON is truncated
        let summary = {};
        const summaryMatch = jsonText.match(/"summary"\s*:\s*(\{.*?\})/s);
        if (summaryMatch) {
          try {
            summary = JSON.parse(summaryMatch[1]);
          } catch (e) {
            // Ignore partial summary
          }
        }

        const transactions: any[] = [];
        // Match flat JSON objects containing "date" and "amount"
        const objRegex = /\{[^{}]*"date"\s*:\s*"[^"]*"[^{}]*"amount"\s*:\s*[\d.]+[^{}]*\}/g;
        let txMatch;
        while ((txMatch = objRegex.exec(jsonText)) !== null) {
          try {
            // Clean up potential trailing commas before the closing brace
            let cleanObjStr = txMatch[0].replace(/,\s*\}/g, '}');
            transactions.push(JSON.parse(cleanObjStr));
          } catch (err) {
            // Ignore invalid objects
          }
        }

        if (transactions.length > 0) {
          extractedData = { summary, transactions };
        } else {
          throw parseError; // Re-throw if we couldn't salvage anything
        }
      }
    } catch (e) {
      console.error("Failed to parse extraction response", e);
      throw new Error("Failed to extract statement data.");
    }

    const extractedTransactions = extractedData.transactions || [];
    const extractedSummary = extractedData.summary || {
      total_deposits: 0,
      total_withdrawals: 0,
      net_cash_flow: 0,
      total_transactions: 0,
      dr_count: 0,
      cr_count: 0
    };

    // Map to internal Transaction format
    let transactions: Transaction[] = extractedTransactions.map((item: any, index: number) => {
      const isDebit = item.type === "debit" || item.type === "debit/credit";
      return {
        id: `tx-${Date.now()}-${index}`,
        date: item.date,
        narration: item.narration,
        refNo: item.reference || "",
        withdrawal: isDebit ? item.amount : 0,
        deposit: isDebit ? 0 : item.amount,
        balance: item.balance || 0,
        category: item.category || "General Business Expense",
        group: item.group_tag || "Unclassified"
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
              text: `Analyze these transactions and provide insights.
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
        1. Aggregate categories and groups accurately based on the provided transactions.
        2. Identify anomalies (unusual spikes, double charges) and recommendations.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            insights: {
              type: Type.OBJECT,
              properties: {
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
              required: ["categories", "groups", "anomalies", "recommendations"],
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

      const finalSummary = {
        totalDeposits: extractedSummary.total_deposits || 0,
        totalWithdrawals: extractedSummary.total_withdrawals || 0,
        netCashFlow: extractedSummary.net_cash_flow || 0,
        transactionCount: transactions.length, // Always use actual extracted array length
        drCount: transactions.filter(t => t.withdrawal > 0).length, // Calculate actual DR count
        crCount: transactions.filter(t => t.deposit > 0).length // Calculate actual CR count
      };

      // Ensure defaults to prevent crashes
      if (!result.insights) {
        result.insights = {
          summary: finalSummary,
          categories: [],
          groups: [],
          anomalies: [],
          recommendations: []
        };
      } else {
        result.insights.summary = finalSummary;
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
