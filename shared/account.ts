export type Account = {
  testing: boolean;
  plan: "free" | "plus"; activeLimit: number | null; activeCount: number; pausedCount: number;
  paidThrough: number | null; cancelAtPeriodEnd: boolean; paymentPastDue: boolean; canCreate: boolean;
  billingAvailable: boolean; billingMode: "test" | "live" | null; hasCustomer: boolean; deletionState: string;
};
