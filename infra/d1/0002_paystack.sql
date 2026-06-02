-- Migrate from Stripe to Paystack
ALTER TABLE subscriptions RENAME COLUMN stripe_customer_id TO paystack_customer_code;
ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_id TO paystack_subscription_code;

-- Drop old stripe index and create new paystack index
DROP INDEX IF EXISTS idx_subscriptions_stripe;
CREATE INDEX idx_subscriptions_paystack ON subscriptions(paystack_customer_code);
