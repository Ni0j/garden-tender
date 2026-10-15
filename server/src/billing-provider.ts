export type BillingInterval = "month" | "year";
export type SubscriptionSnapshot = { id: string; status: string; priceId: string; paidThrough: number; cancelAtPeriodEnd: boolean };
export type BillingEvent = { id: string; customerId: string | null };
// Garden owns entitlements. Providers only supply verified billing facts.
export interface BillingProvider {
  name: string;
  mode: "test" | "live";
  validate(): Promise<void>;
  createCustomer(userId: string, email: string): Promise<string>;
  subscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  checkout(customerId: string, interval: BillingInterval, userId: string): Promise<string>;
  portal(customerId: string): Promise<string>;
  verifyEvent(rawBody: string, signature: string): BillingEvent | Promise<BillingEvent>;
  closeAccount(customerId: string): Promise<void>;
}
