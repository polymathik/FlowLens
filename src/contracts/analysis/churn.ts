export type FileChurnData = {
  file: string;
  change_count: number;
  period_days: number;
  churn_rate: number;
  /** ISO-8601 author date of the most recent commit touching the file within the period. */
  last_changed: string;
};
