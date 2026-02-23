export interface InsightsEngine {
  getWeeklyTrendSummary(): Promise<string | null>;
}
